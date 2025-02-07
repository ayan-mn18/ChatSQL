import { Sequelize } from "sequelize";

const { DB_HOST, DB_PORT, DB_NAME, DB_USERNM, DB_PWD } = process.env;

export const sequelize = new Sequelize({
  dialect: "postgres",
  host: DB_HOST!,
  port: 5432,
  database: DB_NAME!,
  username: DB_USERNM!,
  password: DB_PWD!
});

