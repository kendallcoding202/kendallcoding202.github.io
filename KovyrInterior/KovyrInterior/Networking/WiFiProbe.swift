import Foundation
import NetworkExtension
import CoreLocation

/// The Wi-Fi network this device is currently joined to.
struct WiFiNetwork: Equatable {
    var ssid: String
    var bssid: String?        // router's MAC / BSSID (nil if iOS withholds it)
    var signalStrength: Double // 0.0 (weak) … 1.0 (strong)
}

/// Reads the current Wi-Fi network's SSID / BSSID / signal via
/// `NEHotspotNetwork.fetchCurrent`. iOS only reveals these once the app holds the
/// `com.apple.developer.networking.wifi-info` entitlement AND the user has granted
/// When-In-Use location permission, so this drives the location prompt first.
///
/// Personal build only — the entitlement requires the App ID to have "Access WiFi
/// Information" enabled, which automatic signing registers during a device build.
final class WiFiProbe: NSObject, CLLocationManagerDelegate {
    /// Called on the main queue with the current network (or nil if unavailable /
    /// permission denied / not on Wi-Fi).
    var onUpdate: ((WiFiNetwork?) -> Void)?

    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
    }

    /// Request permission if needed, then fetch. Safe to call repeatedly.
    func refresh() {
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization() // delegate fires → fetch()
        case .authorizedWhenInUse, .authorizedAlways:
            fetch()
        default:
            onUpdate?(nil) // denied / restricted
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            fetch()
        case .denied, .restricted:
            onUpdate?(nil)
        default:
            break
        }
    }

    private func fetch() {
        NEHotspotNetwork.fetchCurrent { [weak self] net in
            let result: WiFiNetwork? = net.map {
                WiFiNetwork(
                    ssid: $0.ssid,
                    bssid: $0.bssid.isEmpty ? nil : $0.bssid,
                    signalStrength: $0.signalStrength
                )
            }
            DispatchQueue.main.async { self?.onUpdate?(result) }
        }
    }
}
