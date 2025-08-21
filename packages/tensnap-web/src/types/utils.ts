export type JsonSerializable =
  | string
  | number
  | boolean
  | null
  | JsonSerializable[]
  | { [key: string]: JsonSerializable };

export type MsgpackSerializable =
  | null
  | boolean
  | number
  | string
  | MsgpackSerializable[]
  | { [key: string]: MsgpackSerializable }
  | { [key: number]: MsgpackSerializable }
  | Uint8Array;