interface User {
  id: string;
  email: string;
  name: string;
  age: number;
}

const users: User[] = [];

export function createUser(email: string, name: string, age: number): User | null {
  if (!email || email.indexOf('@') === -1 || email.indexOf('.') === -1) {
    console.log('bad email');
    return null;
  }
  if (!name || name.length < 2 || name.length > 50) {
    console.log('bad name');
    return null;
  }
  if (age < 0 || age > 150 || !Number.isInteger(age)) {
    console.log('bad age');
    return null;
  }
  for (let i = 0; i < users.length; i++) {
    if (users[i].email === email) {
      console.log('email exists');
      return null;
    }
  }
  const user = { id: Math.random().toString(36).substr(2, 9), email, name, age };
  users.push(user);
  return user;
}

export function updateUser(id: string, email?: string, name?: string, age?: number): User | null {
  let user = null;
  for (let i = 0; i < users.length; i++) {
    if (users[i].id === id) {
      user = users[i];
      break;
    }
  }
  if (!user) {
    console.log('not found');
    return null;
  }
  if (email !== undefined) {
    if (!email || email.indexOf('@') === -1 || email.indexOf('.') === -1) {
      console.log('bad email');
      return null;
    }
    for (let i = 0; i < users.length; i++) {
      if (users[i].email === email && users[i].id !== id) {
        console.log('email exists');
        return null;
      }
    }
    user.email = email;
  }
  if (name !== undefined) {
    if (!name || name.length < 2 || name.length > 50) {
      console.log('bad name');
      return null;
    }
    user.name = name;
  }
  if (age !== undefined) {
    if (age < 0 || age > 150 || !Number.isInteger(age)) {
      console.log('bad age');
      return null;
    }
    user.age = age;
  }
  return user;
}

export function deleteUser(id: string): boolean {
  for (let i = 0; i < users.length; i++) {
    if (users[i].id === id) {
      users.splice(i, 1);
      return true;
    }
  }
  return false;
}

export function getUser(id: string): User | null {
  for (let i = 0; i < users.length; i++) {
    if (users[i].id === id) {
      return users[i];
    }
  }
  return null;
}
