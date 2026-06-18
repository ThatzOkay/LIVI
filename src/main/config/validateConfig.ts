type ConfigValue = unknown
type ConfigSchema = Record<string, ConfigValue>

export function validate<T extends ConfigSchema>(input: unknown, schema: T): T {
  const result = {} as T

  const source =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}

  for (const key of Object.keys(schema) as Array<keyof T>) {
    const def = schema[key]
    const val = source[key as string]

    if (val === undefined) {
      result[key] = def
      continue
    }

    if (Array.isArray(def)) {
      result[key] = (Array.isArray(val) ? val : def) as T[keyof T]
      continue
    }

    if (
      typeof def === 'object' &&
      def !== null &&
      typeof val === 'object' &&
      val !== null &&
      !Array.isArray(def)
    ) {
      result[key] = validate(val, def as ConfigSchema) as T[keyof T]
      continue
    }

    result[key] = (typeof val === typeof def ? val : def) as T[keyof T]
  }

  // Optional Config fields with no static default (e.g. lastKnownGps, radio) have no key
  // in the schema, so the loop above never touches them. Pass them through as-is instead
  // of silently dropping them on every load.
  for (const key of Object.keys(source)) {
    if (!(key in schema) && source[key] !== undefined) {
      result[key as keyof T] = source[key] as T[keyof T]
    }
  }

  return result
}
