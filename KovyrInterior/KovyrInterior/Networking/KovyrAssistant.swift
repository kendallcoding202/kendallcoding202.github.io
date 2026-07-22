import Foundation

/// One turn in the assistant conversation.
struct ChatMessage: Identifiable, Equatable {
    enum Role { case user, assistant }
    let id = UUID()
    let role: Role
    var text: String
}

private struct AssistantError: Error { let message: String }

/// In-app "Ask Kovyr" helper. Streams answers from Claude (Opus 4.8) directly
/// from the device, using the user's own Anthropic API key from the Keychain.
/// Personal build only — no server, no shared backend. The key is read fresh on
/// each request and only ever sent to Anthropic as the `x-api-key` header.
@MainActor
final class KovyrAssistant: ObservableObject {
    @Published private(set) var messages: [ChatMessage] = []
    @Published private(set) var isSending = false
    @Published var errorText: String?

    /// Higher tier for specific, detailed explanations (personal, single user).
    private let model = "claude-opus-4-8"
    private let maxTokens = 2048
    private var contextPreamble: String?

    var hasKey: Bool { KeychainStore.hasAPIKey }
    var isEmpty: Bool { messages.isEmpty }

    /// Scan context (device details / findings) prepended to the system prompt so
    /// answers are specific to what's on screen. Pass nil for the general chat.
    func setContext(_ text: String?) { contextPreamble = text }

    func reset() {
        messages.removeAll()
        errorText = nil
    }

    func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSending else { return }
        guard let key = KeychainStore.apiKey() else {
            errorText = "Add your Anthropic API key in Settings to use the assistant."
            return
        }

        messages.append(ChatMessage(role: .user, text: trimmed))
        messages.append(ChatMessage(role: .assistant, text: ""))
        let index = messages.count - 1
        isSending = true
        errorText = nil

        Task {
            do {
                try await stream(key: key) { [weak self] delta in
                    guard let self, index < self.messages.count else { return }
                    self.messages[index].text += delta
                }
            } catch {
                if index < messages.count, messages[index].text.isEmpty {
                    messages.remove(at: index)
                }
                errorText = (error as? AssistantError)?.message ?? error.localizedDescription
            }
            isSending = false
        }
    }

    // MARK: - Networking

    private func stream(key: String, onDelta: @escaping (String) -> Void) async throws {
        var req = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        req.httpMethod = "POST"
        req.setValue(key, forHTTPHeaderField: "x-api-key")
        req.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.timeoutInterval = 120

        let payload: [String: Any] = [
            "model": model,
            "max_tokens": maxTokens,
            "stream": true,
            "system": systemPrompt(),
            "messages": apiMessages(),
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (bytes, response) = try await URLSession.shared.bytes(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw AssistantError(message: "No response from Claude.")
        }
        guard http.statusCode == 200 else {
            var body = ""
            for try await line in bytes.lines { body += line }
            throw AssistantError(message: errorMessage(status: http.statusCode, body: body))
        }

        // Server-Sent Events: parse `data:` lines, append text_delta chunks.
        for try await line in bytes.lines {
            guard line.hasPrefix("data:") else { continue }
            let json = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
            guard !json.isEmpty, json != "[DONE]",
                  let data = json.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let type = obj["type"] as? String
            else { continue }

            if type == "content_block_delta",
               let delta = obj["delta"] as? [String: Any],
               let piece = delta["text"] as? String {
                onDelta(piece)
            } else if type == "error" {
                let msg = (obj["error"] as? [String: Any])?["message"] as? String
                throw AssistantError(message: msg ?? "Claude returned an error.")
            }
        }
    }

    private func apiMessages() -> [[String: String]] {
        messages
            .filter { !($0.role == .assistant && $0.text.isEmpty) }
            .map { ["role": $0.role == .user ? "user" : "assistant", "content": $0.text] }
    }

    private func systemPrompt() -> String {
        var prompt = """
        You are Kovyr, an assistant built into the Kovyr Interior iOS app — a \
        local-network scanner for home and small-business Wi-Fi. You explain \
        networking and security findings to a single non-expert owner in plain, \
        practical English. Be specific and thorough, but define any technical term \
        the first time you use it. For a device, port, or service, cover: what it \
        is, whether it's normal or a risk on a private network, and what the person \
        can do about it. Never invent device details you weren't given; if \
        something is ambiguous, say so and explain how to check.
        """
        if let contextPreamble {
            prompt += "\n\nContext from the current screen:\n\(contextPreamble)"
        }
        return prompt
    }

    private func errorMessage(status: Int, body: String) -> String {
        switch status {
        case 401:
            return "Your Anthropic API key was rejected (401). Check or re-enter it in Settings."
        case 429:
            return "Rate limited by Anthropic (429). Wait a moment and try again."
        case 400:
            return "Anthropic rejected the request (400). \(shortDetail(body))"
        case 529:
            return "Anthropic is temporarily overloaded (529). Try again shortly."
        default:
            return "Claude request failed (\(status)). \(shortDetail(body))"
        }
    }

    /// Pulls the message string out of an Anthropic error body, if present.
    private func shortDetail(_ body: String) -> String {
        if let data = body.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let msg = (obj["error"] as? [String: Any])?["message"] as? String {
            return msg
        }
        return ""
    }
}
