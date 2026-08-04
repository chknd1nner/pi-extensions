import Foundation

final class TranscriptStore {
    func append(_ line: String) -> Int {
        return line.count
    }
}

struct Envelope {
    let id: String
}

func makeEnvelope(id: String) -> Envelope {
    return Envelope(id: id)
}
