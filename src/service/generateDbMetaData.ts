// const tables = [];

import { Sequelize } from "sequelize";
import { DbColumns, DbMetadata, DbTable, Relationships } from "../../types";
import fs from 'fs';


// for(const table of tables){
//   const colsAndDataTypes = [];
//   updateTables();
// }

// const relationShips = [];

export const getTablesAndSchemas = async (sequelize: Sequelize) => {
  const query = `
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema');
  `;

  const result = await sequelize.query(query) as [DbTable[], unknown];
  const tables = result[0];
  if(tables.length > 0){
    for(const tab of tables){
      const cols = await getTableColumns(tab.table_name, tab.table_schema, sequelize);
      tab.columns = cols;
    }
  }

  return tables;
}

async function getTableColumns(tableName: string, schema: string, sequelize: Sequelize) {
  const query = `
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = '${tableName}' AND table_schema = '${schema}';
  `;

  const result = await sequelize.query(query);
  const columns = result[0];
  return columns as DbColumns[];
}

async function getTableRelationships(sequelize: Sequelize) {
  const query = `
    SELECT 
      kcu.table_schema,
      kcu.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.key_column_usage kcu
    JOIN information_schema.constraint_column_usage ccu 
      ON kcu.constraint_name = ccu.constraint_name
    WHERE kcu.table_schema NOT IN ('pg_catalog', 'information_schema');
  `;

  const results = await sequelize.query(query);
  const relationships = results[0] as Relationships[];
  return relationships;
}


import { logger } from "../utils/logger";

export const generateTableMetaData = async (uri: string) => {

  logger.info("generating meta data...")
  const sequelize = new Sequelize(uri, {logging: false});
  const tables  = await getTablesAndSchemas(sequelize);
  const relationships = await getTableRelationships(sequelize);
  const dbMetaData = {tables, relationships} as DbMetadata;

  return dbMetaData;
}