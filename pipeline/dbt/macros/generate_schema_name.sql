{# Use the configured schema verbatim (staging_f1db, core, marts, llm) instead of dbt's
   "<target>_<custom>" concatenation - the schema names are part of the contract. #}
{% macro generate_schema_name(custom_schema_name, node) -%}
  {{ custom_schema_name if custom_schema_name else target.schema }}
{%- endmacro %}
