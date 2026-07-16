import Foundation
import Supabase

/// Owns the shared Supabase client for Interior.
///
/// The client is configured once with the Kovyr project URL + publishable key and
/// reused for auth (step 2) and, later, syncing scans into the evidence locker.
@MainActor
final class SupabaseManager: ObservableObject {
    static let shared = SupabaseManager()

    let client: SupabaseClient

    private init() {
        client = SupabaseClient(
            supabaseURL: SupabaseConfig.url,
            supabaseKey: SupabaseConfig.anonKey
        )
    }

    /// A one-shot "can Interior reach the same backend?" check for step 1.
    ///
    /// Returns a short human-readable status suitable for showing in the UI.
    func testConnection() async -> String {
        // 1. Auth settings endpoint: public and schema-independent. A 200 proves we
        //    reached THIS project with a valid publishable key, and reports whether
        //    email login is enabled (which step 2's OTP flow relies on).
        do {
            let settingsURL = SupabaseConfig.url.appendingPathComponent("auth/v1/settings")
            var request = URLRequest(url: settingsURL)
            request.setValue(SupabaseConfig.anonKey, forHTTPHeaderField: "apikey")
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let http = response as? HTTPURLResponse else {
                return "❌ No HTTP response from the Kovyr backend."
            }
            guard http.statusCode == 200 else {
                return "❌ Reached the server, but the publishable key was rejected (HTTP \(http.statusCode)). Double-check the key."
            }

            var emailNote = "reachable"
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let external = json["external"] as? [String: Any],
               let emailEnabled = external["email"] as? Bool {
                emailNote = emailEnabled ? "email login enabled" : "email login disabled"
            }

            // 2. Anonymous PostgREST read. With org-scoped RLS the anon role sees no
            //    rows, so success here means HTTP 200 with an empty result — which
            //    still proves the database/PostgREST layer is reachable.
            do {
                _ = try await client.from("organizations").select().limit(1).execute()
                return "✅ Connected to the Kovyr backend — \(emailNote), database read OK."
            } catch {
                return "✅ Reached the Kovyr backend (\(emailNote)). Auth is good; the test table read didn't return (\(error.localizedDescription)) — fine for now, we'll use authenticated reads next."
            }
        } catch {
            return "❌ Couldn't reach the Kovyr backend: \(error.localizedDescription). Check the device's internet connection and the project URL."
        }
    }
}
