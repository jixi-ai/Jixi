export interface ScopedPermissions {
  workflows?: string[]
  readOnly?: boolean
}

export interface MintSessionTokenOptions {
  userId: string
  permissions?: ScopedPermissions
  expiresIn?: number
}
