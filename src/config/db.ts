import { Sequelize } from "sequelize";

const { DB_HOST, DB_PORT, DB_NAME, DB_USERNM, DB_PWD } = process.env;

export const sequelize = new Sequelize({
  dialect: "postgres",
  host: DB_HOST!,
  port: 5432,
  database: DB_NAME!,
  username: DB_USERNM!,
  password: DB_PWD!,
  logging: false,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false // Set to true in production with proper certs
    }
  }
});

/**
 * Test database connection
 */
export const connectDatabase = async (): Promise<void> => {
  try {
    await sequelize.authenticate();
    console.log("✅ Database connection established successfully");
  } catch (error) {
    console.error("❌ Unable to connect to the database:", error);
    process.exit(1);
  }
};