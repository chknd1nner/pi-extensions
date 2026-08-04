import Foundation

struct TimelineStore {
    let id: String

    #if DEBUG
    static let debugFlag = true
    #endif

    func count() -> Int { return id.count }
}
