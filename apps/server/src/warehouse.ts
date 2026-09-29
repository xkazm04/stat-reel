/**
 * Read-only access to warehouse.duckdb for the app and the LLM.
 *
 * The LLM's `query` tool may read ONLY the `llm` schema (DESIGN §5.4). Enforced at the parser:
 * `json_serialize_sql` rejects anything but a single SELECT; the AST is walked and every BASE_TABLE
 * must be `llm.<view>` (or a CTE name), and TABLE_FUNCTIONs (read_csv, read_parquet, ...) are
 * refused. The connection is opened READ_ONLY with external access disabled as a second wall.
 */
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

export const ROW_CAP = 5000;
export const QUERY_TIMEOUT_MS = 10_000;

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
  walk(ast.statements as Ast, (n) => {
    if (n.type === "TABLE_FUNCTION") throw new Error("table functions (read_csv, read_parquet, ...) are not allowed");
    if (n.type === "BASE_TABLE") {
      const schema = String(n.schema_name ?? "").toLowerCase();
      const table = String(n.table_name ?? "").toLowerCase();
      if (!schema) {
        if (ctes.has(table)) return;
        throw new Error(`table '${table}' must be qualified as llm.${table}`);
      }
      if (schema !== "llm" || (n.catalog_name && n.catalog_name !== "")) throw new Error(`schema '${schema}' is not readable; use llm.* views`);
    }
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

  async rows(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    const r = await this.conn.runAndReadAll(sql, params as never);
    return (r.getRowObjectsJS() as Record<string, unknown>[]).map(normalizeRow);
  }

  async scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.rows(sql, params);
    return Object.values(rows[0] ?? {})[0] as T;
  }

  /** LLM entry point: guarded, capped, timed out, with lineage of the views it read. */
  async query(sql: string): Promise<QueryResult> {
    await checkReadOnlyLlmSql(this, sql);
    const views = await this.referencedViews(sql);
    const timer = setTimeout(() => this.conn.interrupt(), QUERY_TIMEOUT_MS);
    try {
      const rows = await this.rows(`select * from (${sql.replace(/;\s*$/, "")}) limit ${ROW_CAP + 1}`);
      const truncated = rows.length > ROW_CAP;
      const kept = rows.slice(0, ROW_CAP);
      const lineage = await this.lineage(views);
      return { columns: Object.keys(kept[0] ?? {}), rows: kept, truncated, ...lineage };
    } finally {
      clearTimeout(timer);
    }
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
    const [rowKey, column] = ref.split("#");
    if (!rowKey || !column || !/^[a-z_]+$/.test(column)) return undefined;
    for (const view of await this.factViews()) {
      if (!view.columns.includes(column)) continue;
      const rows = await this.rows(`select "${column}" as v from llm."${view.name}" where fact_key = ?`, [rowKey]);
      if (rows.length) return rows[0]!.v as number | string;
    }
    return undefined;
  }

  async facts(refs: string[]): Promise<Map<string, number | string>> {
    const out = new Map<string, number | string>();
    for (const r of new Set(refs)) {
      const v = await this.fact(r);
      if (v !== undefined) out.set(r, v);
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
