export interface ScopedPermissions {
  workflows?: string[]
  readOnly?: boolean
}

export interface SessionOptions {
  userId: string
  permissions?: ScopedPermissions
  expiresIn?: number
}
