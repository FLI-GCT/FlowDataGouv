/** Environment configuration */
export const config = {
  flowdataUrl: process.env.FLOWDATA_URL || "http://localhost:3000",
  datagouvApiUrl: process.env.DATAGOUV_API_URL || "https://www.data.gouv.fr/api/1",
  tabularApiUrl: process.env.TABULAR_API_URL || "https://tabular-api.data.gouv.fr/api",
  logLevel: process.env.LOG_LEVEL || "INFO",
};
