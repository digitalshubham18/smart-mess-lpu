// // Security policy switches, read at request time (not import time) so they can be changed by the environment alone
// // and so tests can flip them.

// /**
//  * Roles that MUST use two-factor login. Default: the two roles that can do the most damage. Set REQUIRE_2FA_ROLES to a
//  * comma-separated list to change it, or to an empty string to switch the requirement off (local development only).
//  */
// export function twoFactorRoles() {
//   return (process.env.REQUIRE_2FA_ROLES ?? 'SUPER_ADMIN,ADMIN').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
// }
// export const twoFactorRequiredFor = (role) => twoFactorRoles().includes(String(role))
// Security policy switches can be added here when needed.