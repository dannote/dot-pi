import { type TSchema, Type } from 'typebox'

export type ComputerTarget =
  | { kind: 'desktop'; displayId: string }
  | { kind: 'window'; window: string }

const target = Type.Optional(
  Type.Union([
    Type.Object({ kind: Type.Literal('desktop'), displayId: Type.Optional(Type.String()) }),
    Type.Object({ kind: Type.Literal('window'), window: Type.String({ pattern: '^@w\\d+$' }) })
  ])
)

export const schemas = {
  apps: Type.Object({}),
  windows: Type.Object({
    onScreenOnly: Type.Optional(Type.Boolean()),
    pid: Type.Optional(Type.Integer({ minimum: 1 }))
  }),
  observe: Type.Object({ target, session: Type.Optional(Type.String()) }),
  click: Type.Object({
    element: Type.Optional(Type.String({ pattern: '^@e\\d+$' })),
    x: Type.Optional(Type.Number()),
    y: Type.Optional(Type.Number()),
    count: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
    target,
    session: Type.Optional(Type.String())
  }),
  type: Type.Object({ text: Type.String(), target, session: Type.Optional(Type.String()) }),
  key: Type.Object({
    key: Type.String(),
    modifiers: Type.Optional(Type.Array(Type.String())),
    target,
    session: Type.Optional(Type.String())
  }),
  scroll: Type.Object({
    x: Type.Number(),
    y: Type.Number(),
    direction: Type.Union([
      Type.Literal('up'),
      Type.Literal('down'),
      Type.Literal('left'),
      Type.Literal('right')
    ]),
    by: Type.Optional(Type.Union([Type.Literal('line'), Type.Literal('page')])),
    amount: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    target,
    session: Type.Optional(Type.String())
  })
} satisfies Record<string, TSchema>

export type ComputerParams = Record<string, unknown>
