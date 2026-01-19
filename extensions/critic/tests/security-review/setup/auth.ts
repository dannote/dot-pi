import { db } from './db';

export async function login(username: string, password: string): Promise<string | null> {
  // SQL injection vulnerability!
  const query = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;
  const user = await db.query(query);
  
  if (user) {
    // Weak session token
    const token = Buffer.from(username + ':' + Date.now()).toString('base64');
    return token;
  }
  return null;
}

export async function register(username: string, password: string, email: string): Promise<boolean> {
  // No password hashing!
  const query = `INSERT INTO users (username, password, email) VALUES ('${username}', '${password}', '${email}')`;
  
  try {
    await db.query(query);
    return true;
  } catch {
    return false;
  }
}

export function validateSession(token: string): { username: string; timestamp: number } | null {
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const [username, timestamp] = decoded.split(':');
    return { username, timestamp: parseInt(timestamp) };
  } catch {
    return null;
  }
}

export async function changePassword(username: string, oldPassword: string, newPassword: string): Promise<boolean> {
  // Vulnerable to timing attacks, no rate limiting
  const query = `SELECT password FROM users WHERE username = '${username}'`;
  const user = await db.query(query);
  
  if (user && user.password === oldPassword) {
    // Still storing plain text!
    const updateQuery = `UPDATE users SET password = '${newPassword}' WHERE username = '${username}'`;
    await db.query(updateQuery);
    return true;
  }
  return false;
}
