import Foundation

/// Connection coordinates for the shared Kovyr Supabase project — the same
/// backend the Kovyr website uses, so Interior signs in against the same accounts.
///
/// The publishable ("anon") key is *designed* to be embedded in client apps: it
/// is public and safe to ship, because every table is protected by Row-Level
/// Security on the server. (A `service_role` key must NEVER live in the app.)
enum SupabaseConfig {
    static let url = URL(string: "https://nlxagvdkdkuewrejkunm.supabase.co")!
    static let anonKey = "sb_publishable_fvhxuIbkWfTs-Yr5Be6HMA_9o6z3jef"
}
