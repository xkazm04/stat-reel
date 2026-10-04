/**
 * Read-only access to warehouse.duckdb for the app and the LLM.
 *
 * The LLM's `query` tool may read ONLY the `llm` schema (DESIGN §5.4). Enforced at the parser:
 * `json_serialize_sql` rejects anything but a single SELECT; the AST is walked and every FROM-clause
 * node must be on an ALLOWLIST of ref types (BASE_TABLE = `llm.<view>` or a CTE name; SUBQUERY and
 * JOIN are recursed into; EMPTY/VALUES carry no table). Anything else - TABLE_FUNCTION (read_csv, ...),
 * SHOW_REF (`show all tables`, `describe`, `summarize`, which list every schema) or a ref type this
 * guard does not know - is refused, so a new DuckDB node type fails closed. The connection is opened READ_ONLY with external access disabled as a second wall.
 */
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

export const ROW_CAP = 5000;
export const QUERY_TIMEOUT_MS = 10_000;

/** What the model sees when its query is interrupted at the cap (the raw DuckDB "INTERRUPT Error" tells it nothing). */
export const queryTimeoutMessage = (ms: number = QUERY_TIMEOUT_MS) => `query exceeded ${ms / 1000} s - add a WHERE or aggregate`;

/**
 * A fact ref is `<fact_key>#<column>`. The column is interpolated as a quoted identifier, so it is limited to
 * lowercase letters, digits and underscores (no leading digit). Returns a format hint for a ref that cannot
 * resolve for that reason, or undefined when the ref is well-formed.
 */
const FACT_COLUMN = /^[a-z_][a-z0-9_]*$/;
export function factRefFormatHint(ref: string): string | undefined {
  const [rowKey, column, ...rest] = ref.split("#");
  if (!rowKey || !column || rest.length) return `'${ref}' is not '<fact_key>#<column>' (one '#', both parts non-empty)`;
  if (!FACT_COLUMN.test(column)) return `column '${column}' in '${ref}' must match ${FACT_COLUMN} (lowercase letters, digits and underscores, not starting with a digit)`;
  return undefined;
}

export type QueryResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  license_class: string;
  sources: string[];
};

export type ViewDescription = {
  name: string;
  comment: string | null;
  columns: { name: string; type: string; comment: string | null }[];
  sample: Record<string, unknown>[];
  license_class: string;
};

type Ast = Record<string, unknown> | unknown[] | string | number | boolean | null;

function walk(node: Ast, visit: (n: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) node.forEach((n) => walk(n as Ast, visit));
  else if (node && typeof node === "object") {
    visit(node as Record<string, unknown>);
    for (const v of Object.values(node)) walk(v as Ast, visit);
  }
}

export async function checkReadOnlyLlmSql(wh: Warehouse, sql: string): Promise<void> {
  const raw = await wh.scalar<string>("select json_serialize_sql($1::VARCHAR) as j", [sql]);
  const ast = JSON.parse(raw) as { error: boolean; error_message?: string; statements?: unknown[] };
  if (ast.error) {
    const msg = ast.error_message ?? "unparseable";
    throw new Error(/Only SELECT/i.test(msg) ? "only SELECT statements are allowed" : `invalid SQL: ${msg}`);
  }
  if ((ast.statements?.length ?? 0) !== 1) throw new Error("exactly one statement is allowed");
  const ctes = new Set<string>();
  walk(ast.statements as Ast, (n) => {
    const map = (n.cte_map as { map?: { key: string }[] } | undefined)?.map;
    for (const e of map ?? []) ctes.add(e.key.toLowerCase());
  });
  const checkRef = (ref: Record<string, unknown>): void => {
    switch (ref.type) {
      case "BASE_TABLE": {
        const schema = String(ref.schema_name ?? "").toLowerCase();
        const table = String(ref.table_name ?? "").toLowerCase();
        if (!schema) {
          if (ctes.has(table)) return;
          throw new Error(`table '${table}' must be qualified as llm.${table}`);
        }
        if (schema !== "llm" || (ref.catalog_name && ref.catalog_name !== "")) throw new Error(`schema '${schema}' is not readable; use llm.* views`);
        return;
      }
      case "JOIN":
        checkRef(ref.left as Record<string, unknown>);
        checkRef(ref.right as Record<string, unknown>);
        return;
      case "SUBQUERY": // its inner SELECT is visited by the walk below
      case "EMPTY": // `select 1`
      case "EXPRESSION_LIST": // VALUES (...)
        return;
      case "TABLE_FUNCTION":
        throw new Error("table functions (read_csv, read_parquet, ...) are not allowed");
      case "SHOW_REF":
        throw new Error("SHOW / DESCRIBE / SUMMARIZE are not allowed (they list every schema); query llm.* views, or call describe_views for the catalogue");
      default:
        throw new Error(`FROM-clause node '${String(ref.type)}' is not allowed; select from llm.* views, subqueries, joins and CTEs only`);
    }
  };
  walk(ast.statements as Ast, (n) => {
    if (n.from_table && typeof n.from_table === "object") checkRef(n.from_table as Record<string, unknown>);
    // Backstop for table nodes reached outside a from_table slot (e.g. a CTE body's own refs are covered above).
    if (n.type === "TABLE_FUNCTION" || n.type === "SHOW_REF" || n.type === "BASE_TABLE") checkRef(n);
  });
}

/** JSON-safe values: BIGINT -> number (ids and counts are far below 2^53), dates -> ISO strings. */
function normalizeValue(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normalizeValue);
  if (v && typeof v === "object" && "toString" in v && v.constructor?.name?.startsWith("DuckDB")) return String(v);
  return v;
}
const normalizeRow = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, normalizeValue(v)]));

export class Warehouse {
  private constructor(private readonly instance: DuckDBInstance, private readonly conn: DuckDBConnection) {}

  static async open(file: string): Promise<Warehouse> {
    const instance = await DuckDBInstance.create(file, { access_mode: "READ_ONLY" });
    const conn = await instance.connect();
    await conn.run("SET enable_external_access = false");
    await conn.run("SET lock_configuration = true");
    return new Warehouse(instance, conn);
  }

  close(): void {
    this.conn.closeSync();
    this.instance.closeSync();
  }

  async rows(sql: string, params: unknown[] = [], conn: DuckDBConnection = this.conn): Promise<Record<string, unknown>[]> {
    const r = await conn.runAndReadAll(sql, params as never);
    return (r.getRowObjectsJS() as Record<string, unknown>[]).map(normalizeRow);
  }

  async scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.rows(sql, params);
    return Object.values(rows[0] ?? {})[0] as T;
  }

  /** LLM entry point: guarded, capped, timed out, with lineage of the views it read. */
  async query(sql: string, timeoutMs: number = QUERY_TIMEOUT_MS): Promise<QueryResult> {
    await checkReadOnlyLlmSql(this, sql);
    const views = await this.referencedViews(sql);
    // interrupt() is connection-wide: on the shared connection it would also kill a concurrent facts() or
    // describeViews() call. The LLM's query therefore gets its own connection, so the interrupt hits only it.
    const conn = await this.instance.connect();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      conn.interrupt();
    }, timeoutMs);
    let rows: Record<string, unknown>[];
    try {
      rows = await this.rows(`select * from (${sql.replace(/;\s*$/, "")}) limit ${ROW_CAP + 1}`, [], conn);
    } catch (err) {
      if (timedOut) throw new Error(queryTimeoutMessage(timeoutMs));
      throw err;
    } finally {
      clearTimeout(timer);
      conn.closeSync();
    }
    const truncated = rows.length > ROW_CAP;
    const kept = rows.slice(0, ROW_CAP);
    const lineage = await this.lineage(views);
    return { columns: Object.keys(kept[0] ?? {}), rows: kept, truncated, ...lineage };
  }

  private async referencedViews(sql: string): Promise<string[]> {
    const ast = JSON.parse(await this.scalar<string>("select json_serialize_sql($1::VARCHAR)", [sql]));
    const out = new Set<string>();
    walk(ast.statements, (n) => {
      if (n.type === "BASE_TABLE" && String(n.schema_name).toLowerCase() === "llm") out.add(String(n.table_name));
    });
    return [...out];
  }

  /** Most restrictive licence class across the views (meta.model_lineage, from Lane 1). */
  async lineage(views: string[]): Promise<{ license_class: string; sources: string[] }> {
    if (!views.length) return { license_class: "legal", sources: [] };
    const order = ["legal", "non_commercial", "paid", "unknown"];
    const rows = await this.rows(
      `select model, license_class, sources from meta.model_lineage where model in (${views.map(() => "?").join(",")})`,
      views,
    );
    let cls = rows.length === views.length ? "legal" : "unknown";
    const sources = new Set<string>();
    for (const r of rows) {
      if (order.indexOf(String(r.license_class)) > order.indexOf(cls)) cls = String(r.license_class);
      for (const s of (r.sources as string[]) ?? []) sources.add(s);
    }
    return { license_class: cls, sources: [...sources].sort() };
  }

  /** Resolve `<row fact_key>#<column>` against every llm view that has a fact_key column. */
  async fact(ref: string): Promise<number | string | undefined> {
    return (await this.facts([ref])).get(ref);
  }

  /** Batched: one query per (view, column) group instead of one per ref. */
  async facts(refs: string[]): Promise<Map<string, number | string>> {
    const out = new Map<string, number | string>();
    const byColumn = new Map<string, Map<string, string[]>>(); // column -> rowKey -> refs
    for (const ref of new Set(refs)) {
      const [rowKey, column] = ref.split("#");
      if (!rowKey || !column || !FACT_COLUMN.test(column)) continue; // see factRefFormatHint for the message
      const rowsOf = byColumn.get(column) ?? new Map<string, string[]>();
      rowsOf.set(rowKey, [...(rowsOf.get(rowKey) ?? []), ref]);
      byColumn.set(column, rowsOf);
    }
    const views = await this.factViews();
    for (const [column, rowsOf] of byColumn) {
      let pending = [...rowsOf.keys()];
      for (const view of views) {
        if (!pending.length) break;
        if (!view.columns.includes(column)) continue;
        const found = await this.rows(
          `select fact_key as k, "${column}" as v from llm."${view.name}" where fact_key in (${pending.map(() => "?").join(",")})`,
          pending,
        );
        const seen = new Set<string>();
        for (const r of found) {
          const k = String(r.k);
          if (seen.has(k)) continue; // first row wins, as before
          seen.add(k);
          for (const ref of rowsOf.get(k) ?? []) out.set(ref, r.v as number | string);
        }
        pending = pending.filter((k) => !seen.has(k));
      }
    }
    return out;
  }

  private factViewCache?: { name: string; columns: string[] }[];
  private async factViews() {
    if (!this.factViewCache) {
      const rows = await this.rows(
        "select table_name, list(column_name) as cols from duckdb_columns() where schema_name = 'llm' group by table_name",
      );
      this.factViewCache = rows
        .map((r) => ({ name: String(r.table_name), columns: (r.cols as string[]) ?? [] }))
        .filter((v) => v.columns.includes("fact_key"));
    }
    return this.factViewCache;
  }

  async describeViews(sport?: string): Promise<ViewDescription[]> {
    const views = await this.rows("select view_name, comment from duckdb_views() where schema_name = 'llm' order by view_name");
    const out: ViewDescription[] = [];
    for (const v of views) {
      const name = String(v.view_name);
      if (sport && !name.startsWith(`${sport.toLowerCase()}_`)) continue;
      const cols = await this.rows(
        "select column_name, data_type, comment from duckdb_columns() where schema_name = 'llm' and table_name = ? order by column_index",
        [name],
      );
      const sample = await this.rows(`select * from llm."${name}" limit 3`);
      const { license_class } = await this.lineage([name]);
      out.push({
        name: `llm.${name}`,
        comment: (v.comment as string) ?? null,
        columns: cols.map((c) => ({ name: String(c.column_name), type: String(c.data_type), comment: (c.comment as string) ?? null })),
        sample,
        license_class,
      });
    }
    return out;
  }
}
