// Mock database for testing
export const db = {
  async query(sql: string): Promise<any> {
    console.log('Executing:', sql);
    return null;
  }
};
