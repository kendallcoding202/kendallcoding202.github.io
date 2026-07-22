import SwiftUI

/// "Ask Kovyr" chat screen. Streams answers from Claude Opus 4.8 using the user's
/// on-device API key. Can be opened blank (general help) or seeded with scan
/// context and an opening question (e.g. "Explain this device").
struct AssistantView: View {
    /// Scan context prepended to the system prompt (device details / findings).
    var context: String?
    /// A question sent automatically when the screen first appears.
    var openingPrompt: String?

    @StateObject private var assistant = KovyrAssistant()
    @State private var draft = ""
    @FocusState private var inputFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            if !assistant.hasKey {
                noKeyBanner
            }

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if assistant.isEmpty {
                            emptyState
                        }
                        ForEach(assistant.messages) { message in
                            bubble(message).id(message.id)
                        }
                        if let error = assistant.errorText {
                            Text(error)
                                .font(.footnote)
                                .foregroundStyle(.red)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        Color.clear.frame(height: 1).id(bottomID)
                    }
                    .padding()
                }
                .onChange(of: assistant.messages) { _, _ in
                    withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(bottomID, anchor: .bottom) }
                }
            }

            inputBar
        }
        .kovyrScreen()
        .navigationTitle("Ask Kovyr")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { assistant.reset() } label: { Image(systemName: "square.and.pencil") }
                    .disabled(assistant.isEmpty || assistant.isSending)
            }
        }
        .onAppear {
            assistant.setContext(context)
            if let openingPrompt, assistant.isEmpty {
                assistant.send(openingPrompt)
            }
        }
    }

    private let bottomID = "bottom"

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Ask Kovyr", systemImage: "sparkles")
                .font(.headline)
                .foregroundStyle(Color.kovyrGold)
            Text("Ask about anything Kovyr Interior found — an unfamiliar device, an open port, a service name, or what a result means for your network's security. Answers come from Claude and can be detailed.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 8)
    }

    private func bubble(_ message: ChatMessage) -> some View {
        let isUser = message.role == .user
        return HStack {
            if isUser { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 4) {
                if !isUser {
                    Label("Kovyr", systemImage: "sparkles")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.kovyrGold)
                }
                if message.text.isEmpty && !isUser {
                    ProgressView().controlSize(.small)
                } else {
                    Text(message.text)
                        .font(.callout)
                        .textSelection(.enabled)
                        .foregroundStyle(isUser ? .white : .primary)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(
                isUser ? AnyShapeStyle(Color.kovyr) : AnyShapeStyle(Color.white.opacity(0.08)),
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            if !isUser { Spacer(minLength: 40) }
        }
    }

    private var inputBar: some View {
        HStack(spacing: 10) {
            TextField("Ask about your network…", text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .textFieldStyle(.plain)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .focused($inputFocused)
                .disabled(!assistant.hasKey)

            Button {
                let text = draft
                draft = ""
                inputFocused = false
                assistant.send(text)
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(canSend ? Color.kovyrGold : Color.gray)
            }
            .disabled(!canSend)
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }

    private var canSend: Bool {
        assistant.hasKey && !assistant.isSending &&
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var noKeyBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "key.fill").foregroundStyle(Color.kovyrGold)
            Text("Add your Anthropic API key in Settings to use the assistant.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color.kovyrGold.opacity(0.12))
    }
}
