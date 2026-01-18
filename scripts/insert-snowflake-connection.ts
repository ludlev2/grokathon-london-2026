import "dotenv/config";
import { db } from "@grokathon-london-2026/db";
import { snowflakeConnections } from "@grokathon-london-2026/db/schema";
import { encrypt } from "../packages/api/src/services/snowflake/crypto.js";

const ENCRYPTION_KEY = process.env.CREDENTIALS_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error("CREDENTIALS_ENCRYPTION_KEY is required");
}

const privateKey = `MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQD6PE21JpBvC6OT23XlA05ktYieYde2COUapVFnaVD3lO9WsrGd2V8_q_V8nm10lhHsjVLCYa3M7S4Druo_OhHT_YTd1jE9kiJyn9RPuVignKX8I3vR8FDSJNOrJ8v70yO4SXqxKzU6gde8IoEjiMZotBxss1Bmkyl3k8eEtct0G6yXjJOhqTGQYarw4o7iEcXne-cbW2r0XKTkhZ499obeaUh5I9z9CnsKbK6WD5wtbZpDrFYB6Ww3jMigfI5Iob3lWX5qdGggLYwW2b_hgwGM2vXIJG4u5PwJV2qVKVDH8cc3ARPDi32QEV7fGu15Gav_oUbyfvV6NvnKhts9_oG3AgMBAAECggEAeq6HAImsJS0lIO_nAITa8cgId3ILwkzhGeu0GcmJ7x__KVfJedSg_IPvgo3fptmOZxWwXelqvr4HobmnUaFELVUtR19kW8XiCqVufzmlCHVUcWXqJja2QRjaB58mxEszR34K34KKAam33Z5jBstfTuUCzI4rHGcI3P3AQ0Gnwj94898w5wP6eKHQBg9X9Lliz0L995KiU_BsEzKlXleyxuaPt-grIVREMUyRiKpp2RkM8QTY-yJHLhKRH7J29NUO3Rj03snpQHj5ml2CjfJ1y7Rhjp6IDxdpusXV3if-igrkBldRKOl5UR70IADqWltHlKAKGBWJmy9A5FddUJAN0QKBgQD-VTm_8B0pIQYAQZhdjSU6XNxt1pjexKX_G5aA6XoFjNS2KuJYDOnvk68fCe_VId8HPGI8uT6fRykd2mBRGY1lW_dVrCiM124tkvjvuDqa-p1Fq5yKmCxQJrpvZBE1uKHwcDuHIO-bu17IRI_IfWOWoG7v9fvyt62L6_aYHp_wZwKBgQD74DPZ3uYlQ7jFEfTdU2ZEtpG-bhYr3t6BQ86jc37PkBMleEP5FZhcJ_7aD8WMo6U_4gwJLoH_FnO-c5YNkVWsgks1gV3VvmLPYExiEhC826j_CJlxqhQix2NBaNP2SBCi3MBVqVs4U0qK6mrfi1QZfegMi4L0GAyaBD9vQEvSMQKBgQC9DgUblBVZGV8omZn1EJJ3y8dfLoH8NhlehNdfhC5cKc-EimQuJ4tNt24ZmH1a5Q6whkZP9TODmpYJxuaJ4oCks7QrTwnlh84yummpaDzILzrxKxv2Oh_WhLNZUf0o_dICtKrLS8RQ8vsFy1FGK074DNHqNePPDJJIzGJFuZ4SSQKBgEyyNJe_G-109apskVdjsdxyi2alNvMc5jwOXbm_zXl-sZXTTT9nqAFH3H6iFtGAcy1Es82H7-Ww_IWdxK9U9fWVpzkfr2cKliP3esrSHW6kpI0kHTVTSNZeSIb-WKzBvO8asSZkb3ZzRluOjgSL9Ivenu5S_Qk-2Xd8m6RQu8XBAoGAUkgTEIi2246s3x8RpaoFs3TpoftDnvvux6uSmzllNdtIDp5vVZINv_aCxTASDi7nWUe8Sw49tMhIzQYEDGOuEvSuKWOJlXRrC3geUPoNBgYYy-a-iSjiEyGH12Ibh-A2Kc3Y4iaB4XOXUnxFmERxoIOE5t8A0i7ZEa2ECufJ3IY=`;

const credentials = {
  authMethod: "key_pair" as const,
  privateKey,
};

const encryptedCredentials = encrypt(JSON.stringify(credentials), ENCRYPTION_KEY);

async function main() {
  const [inserted] = await db
    .insert(snowflakeConnections)
    .values({
      name: "Rill NorthOne",
      account: "yulufcj-hb86678",
      username: "RILL_USER",
      warehouse: "COMPUTE_WH",
      database: "DATA_DB",
      schema: "NORTH_ONE",
      role: "RILL_ROLE",
      authMethod: "key_pair",
      encryptedCredentials,
      status: "active",
    })
    .returning();

  console.log("Inserted Snowflake connection:", inserted);
}

main().catch(console.error);
