// MIT. The same canonical BSON representation is used by live and retained reads.
import { BSON } from 'mongodb';

export const canonicalEjson = value => BSON.EJSON.serialize(value, { relaxed: false });
export function bsonType(value) {
  if (value === null) return 'null';
  if (value?._bsontype) return value._bsontype;
  if (value instanceof Date) return 'Date';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
