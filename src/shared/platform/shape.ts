/** Shape checks that the message and settings guards share. */

export type Fields = Record<string, unknown>;

/** Whether the value is an object (an array counts) that is not `null`. */
export function isObject(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null;
}

/** Whether the value is an object whose `type` field is `type`. */
export function hasType(value: unknown, type: string): value is Fields {
  return isObject(value) && value['type'] === type;
}
