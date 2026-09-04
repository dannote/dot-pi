import { Type } from 'typebox'

export const createSchema = Type.Object({
  name: Type.String({ description: 'Short worktree and branch name' }),
  baseBranch: Type.Optional(Type.String({ description: 'Branch to base off; defaults to HEAD' }))
})

export const listSchema = Type.Object({})

export const removeSchema = Type.Object({
  name: Type.String({ description: 'Worktree directory name or branch name' }),
  force: Type.Optional(Type.Boolean({ description: 'Remove despite uncommitted changes' }))
})

export const statusSchema = Type.Object({
  name: Type.String({ description: 'Worktree directory name or branch name' })
})
