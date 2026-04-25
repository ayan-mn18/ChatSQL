export type DbTable = {
  table_schema: string,
  table_name: string,
  columns?: DbColumns[] 
}

export type DbColumns = {
  column_name: string,
  data_type: string
}

export type DbMetadata = {
  tables: DbTable[],
  relationships: Relationships[]
}

export type Relationships = {
  table_schema: string,
  table_name: string,
  column_name: string,
  foreign_table_name: string,
  foreign_column_name: string
}