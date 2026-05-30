/**
 * Alertify - SOS Emergency Application Core Logic
 * 
 * Includes:
 * 1. App Navigation & Theme Styling
 * 2. Geolocation Tracker (Browser Geolocation API & Address Geocoding)
 * 3. Map Manager (Google Maps API with dynamic Leaflet.js / OpenStreetMap fallback)
 * 4. Firebase Sync & LocalStorage Fallback Storage Engine
 * 5. Emergency SOS Trigger (Countdown, Alarm UI, Call/SMS link generation)
 * 6. Contact Directory (CRUD operations)
 * 7. Nearby Safe Places (Google Places API & Fallback Geo-Generator)
 * 8. Log History Manager
 * 
 * Developed by Kushagri Sharma
 */

// Import Firebase connection utilities
import { 
  db, 
  isFirebasePlaceholder, 
  ref, 
  set, 
  push, 
  onValue, 
  remove, 
  child, 
  get,
  off,
  twilioConfig,
  isTwilioConfigured
} from "./firebase.js";

// ==========================================
// APPLICATION CONFIGURATION & STATE
// ==========================================
const state = {
  currentCoords: { lat: 28.6139, lng: 77.2090 }, // Default to New Delhi (fallback coords)
  gpsAccuracy: 0,
  resolvedAddress: "Locating your position...",
  contacts: [],
  history: [],
  activeTab: "dashboard-section",
  sosCountdownTimer: null,
  sosCountdownValue: 3,
  isAlarmActive: false,
  mapEngine: "none", // 'google', 'leaflet', or 'none'
  mainMap: null,     // Main location map instance
  mainMarker: null,  // Marker representing current user position on main map
  placesMap: null,   // Map instance for nearby safe places
  placesMarker: null,// Marker for nearby safe places user position
  placeMarkers: [],  // Array tracking nearby place markers
  currentPlaceType: "hospital", // Current places filter type
  deviceId: null      // Unique device identifier for database isolation
};

// Helper to fetch or generate a unique device ID
function getOrCreateDeviceId() {
  let id = localStorage.getItem("alertify_device_id");
  if (!id) {
    // Generate a robust unique ID: dev_ + random token + timestamp
    const randomPart = Math.random().toString(36).substring(2, 10);
    id = `dev_${randomPart}_${Date.now()}`;
    localStorage.setItem("alertify_device_id", id);
  }
  state.deviceId = id;
  return id;
}

// ==========================================
// INITIALIZATION ON DOCUMENT LOAD
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  getOrCreateDeviceId(); // Load or generate private device identifier
  initAppNavigation();
  initStorageEngine();
  startLiveGPSWatch();
  initMapManager();
  setupEventListeners();

  // Register PWA Service Worker for offline availability and update notifications
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => {
          console.log('✅ Service Worker registered successfully with scope:', reg.scope);

          const updateBanner = document.getElementById("appUpdateBanner");
          const updateBtn = document.getElementById("updateAppBtn");
          const dismissBtn = document.getElementById("dismissUpdateBtn");

          if (!updateBanner || !updateBtn || !dismissBtn) return;

          function showUpdateBanner(worker) {
            updateBanner.classList.remove("hidden");
            
            // On update click, send message to skip waiting
            updateBtn.onclick = () => {
              worker.postMessage({ type: 'SKIP_WAITING' });
              updateBanner.classList.add("hidden");
            };

            dismissBtn.onclick = () => {
              updateBanner.classList.add("hidden");
            };
          }

          // Check if there is already a service worker waiting to activate
          if (reg.waiting) {
            showUpdateBanner(reg.waiting);
          }

          // Listen for new service worker installation
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                  // New content is available and can be activated
                  showUpdateBanner(newWorker);
                }
              }
            });
          });
        })
        .catch(err => console.error('❌ Service Worker registration failed:', err));

      // Page reload listener on controller change (service worker take-over)
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          console.log('🔄 New Service Worker active, reloading page...');
          window.location.reload();
        }
      });
    });
  }
});

// ==========================================
// 1. NAVIGATION & ROUTING
// ==========================================
function initAppNavigation() {
  const navItems = document.querySelectorAll(".nav-item");
  const sections = document.querySelectorAll(".app-section");

  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const targetSectionId = item.getAttribute("data-target");
      
      // Update nav link active state
      navItems.forEach(nav => nav.classList.remove("active"));
      item.classList.add("active");

      // Toggle visible section
      sections.forEach(section => {
        if (section.id === targetSectionId) {
          section.classList.add("active");
          state.activeTab = targetSectionId;
          
          // Trigger map refreshes if entering map-related tabs
          setTimeout(() => {
            refreshMapsLayout();
          }, 100);
        } else {
          section.classList.remove("active");
        }
      });
    });
  });

  // Display unconfigured Firebase banner warning if running local mode
  if (isFirebasePlaceholder) {
    const localBanner = document.getElementById("localModeBanner");
    if (localBanner) {
      localBanner.classList.remove("hidden");
    }
  }

  // Handle banner close button
  const closeBannerBtn = document.getElementById("closeBannerBtn");
  if (closeBannerBtn) {
    closeBannerBtn.addEventListener("click", () => {
      document.getElementById("localModeBanner").classList.add("hidden");
    });
  }
}

// Helper to force map viewport recalculation (necessary for responsive sizing)
function refreshMapsLayout() {
  if (state.mapEngine === "leaflet") {
    if (state.activeTab === "map-section" && state.mainMap) {
      state.mainMap.invalidateSize();
      state.mainMap.setView(state.currentCoords, 15);
    } else if (state.activeTab === "places-section" && state.placesMap) {
      state.placesMap.invalidateSize();
      state.placesMap.setView(state.currentCoords, 14);
    }
  } else if (state.mapEngine === "google") {
    if (state.activeTab === "map-section" && state.mainMap) {
      google.maps.event.trigger(state.mainMap, "resize");
      state.mainMap.setCenter(state.currentCoords);
    } else if (state.activeTab === "places-section" && state.placesMap) {
      google.maps.event.trigger(state.placesMap, "resize");
      state.placesMap.setCenter(state.currentCoords);
    }
  }
}

// ==========================================
// 2. STORAGE ENGINE (FIREBASE OR LOCALSTORAGE)
// ==========================================
function initStorageEngine() {
  if (!isFirebasePlaceholder && db) {
    // 1. Sync Contacts from Firebase under private device ID namespace
    const contactsRef = ref(db, `devices/${state.deviceId}/contacts`);
    onValue(contactsRef, (snapshot) => {
      const data = snapshot.val();
      state.contacts = [];
      if (data) {
        Object.keys(data).forEach(key => {
          state.contacts.push({ id: key, ...data[key] });
        });
      } else {
        // Automatically seed the user's contact numbers on first load
        const defaultContacts = [
          { name: "Support Contact 1", phone: "9079945728", relationship: "Relative" },
          { name: "Support Contact 2", phone: "9079397361", relationship: "Relative" },
          { name: "Support Contact 3", phone: "6376189404", relationship: "Friend" }
        ];
        defaultContacts.forEach(c => saveContactToStorage(c));
      }
      renderContacts();
      updateDashboardStats();
    });

    // 2. Sync History logs from Firebase under private device ID namespace
    const historyRef = ref(db, `devices/${state.deviceId}/history`);
    onValue(historyRef, (snapshot) => {
      const data = snapshot.val();
      state.history = [];
      if (data) {
        Object.keys(data).forEach(key => {
          state.history.push({ id: key, ...data[key] });
        });
        // Sort history by newest timestamp first
        state.history.sort((a, b) => b.timestamp - a.timestamp);
      }
      renderHistory();
      updateDashboardStats();
    });
  } else {
    // LocalStorage fallback routines
    loadLocalContacts();
    if (state.contacts.length === 0) {
      const defaultContacts = [
        { name: "Support Contact 1", phone: "9079945728", relationship: "Relative" },
        { name: "Support Contact 2", phone: "9079397361", relationship: "Relative" },
        { name: "Support Contact 3", phone: "6376189404", relationship: "Friend" }
      ];
      defaultContacts.forEach(c => saveContactToStorage(c));
    }
    loadLocalHistory();
    updateDashboardStats();
  }
}

// --- Contact Storage Triggers ---
function saveContactToStorage(contact) {
  if (!isFirebasePlaceholder && db) {
    const contactsRef = ref(db, `devices/${state.deviceId}/contacts`);
    const newContactRef = push(contactsRef);
    set(newContactRef, contact)
      .then(() => console.log("Contact pushed to Firebase."))
      .catch(err => console.error("Firebase write error:", err));
  } else {
    const localContacts = JSON.parse(localStorage.getItem("alertify_contacts")) || [];
    contact.id = "local_" + Date.now();
    localContacts.push(contact);
    localStorage.setItem("alertify_contacts", JSON.stringify(localContacts));
    loadLocalContacts();
  }
}

function deleteContactFromStorage(contactId) {
  if (!isFirebasePlaceholder && db) {
    const contactRef = ref(db, `devices/${state.deviceId}/contacts/${contactId}`);
    remove(contactRef)
      .then(() => console.log("Contact deleted from Firebase."))
      .catch(err => console.error("Firebase delete error:", err));
  } else {
    let localContacts = JSON.parse(localStorage.getItem("alertify_contacts")) || [];
    localContacts = localContacts.filter(c => c.id !== contactId);
    localStorage.setItem("alertify_contacts", JSON.stringify(localContacts));
    loadLocalContacts();
  }
}

function loadLocalContacts() {
  state.contacts = JSON.parse(localStorage.getItem("alertify_contacts")) || [];
  renderContacts();
}

// --- History Storage Triggers ---
function logAlertToStorage(alertObj) {
  if (!isFirebasePlaceholder && db) {
    const historyRef = ref(db, `devices/${state.deviceId}/history`);
    const newHistoryRef = push(historyRef);
    set(newHistoryRef, alertObj)
      .then(() => console.log("SOS Alert log saved to Firebase."))
      .catch(err => console.error("Firebase history log error:", err));
  } else {
    const localHistory = JSON.parse(localStorage.getItem("alertify_history")) || [];
    alertObj.id = "log_" + Date.now();
    localHistory.push(alertObj);
    localStorage.setItem("alertify_history", JSON.stringify(localHistory));
    loadLocalHistory();
  }
}

function clearHistoryFromStorage() {
  if (!isFirebasePlaceholder && db) {
    const historyRef = ref(db, `devices/${state.deviceId}/history`);
    set(historyRef, null)
      .then(() => console.log("Firebase alert history cleared."))
      .catch(err => console.error("Firebase clear error:", err));
  } else {
    localStorage.removeItem("alertify_history");
    loadLocalHistory();
  }
}

function loadLocalHistory() {
  state.history = JSON.parse(localStorage.getItem("alertify_history")) || [];
  state.history.sort((a, b) => b.timestamp - a.timestamp);
  renderHistory();
}

// ==========================================
// 3. GEOLOCATION MANAGEMENT
// ==========================================
function startLiveGPSWatch() {
  if (!navigator.geolocation) {
    console.error("Geolocation is not supported by this browser.");
    updateGpsIndicators("Unsupported");
    return;
  }

  // Active watching options for emergency coordinates accuracy
  const geoOptions = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0
  };

  navigator.geolocation.watchPosition(
    (position) => {
      state.currentCoords.lat = position.coords.latitude;
      state.currentCoords.lng = position.coords.longitude;
      state.gpsAccuracy = position.coords.accuracy;
      
      updateGpsIndicators("Active");
      reverseGeocodeCoordinates(state.currentCoords.lat, state.currentCoords.lng);
      
      // Realtime map centers updating
      updateMapPositions();

      // Stream coordinates to cloud/local if SOS alarm is active (live tracking)
      if (state.isAlarmActive) {
        updateActiveSosCoordinates();
      }
    },
    (error) => {
      console.error("GPS tracking error:", error);
      updateGpsIndicators("Error/Denied");
      
      // Provide user fallback tips inside coordinates displays
      const coordLabel = `GPS Unavailable (${error.message})`;
      document.getElementById("dashCoords").innerText = coordLabel;
      document.getElementById("mapLat").innerText = "--";
      document.getElementById("mapLng").innerText = "--";
      document.getElementById("mapAccuracy").innerText = "--";
      document.getElementById("addressText").innerText = "Please enable GPS permissions in your browser.";
    },
    geoOptions
  );
}

// Stream current coordinates to cloud/local tracking node
function updateActiveSosCoordinates() {
  const trackingObj = {
    latitude: state.currentCoords.lat,
    longitude: state.currentCoords.lng,
    accuracy: state.gpsAccuracy,
    address: state.resolvedAddress,
    lastUpdated: Date.now()
  };

  if (!isFirebasePlaceholder && db) {
    const sosRef = ref(db, `devices/${state.deviceId}/active_sos`);
    set(sosRef, trackingObj)
      .catch(err => console.error("Error streaming active coordinates:", err));
  } else {
    localStorage.setItem("alertify_active_sos", JSON.stringify(trackingObj));
  }
}

// Twilio Cloud SMS & Voice Call automated API requests
function triggerTwilioAlerts(mapsLink) {
  if (!isTwilioConfigured) {
    console.warn("Twilio is not configured. Skipping automated call and SMS alerts.");
    return;
  }

  const { accountSid, authToken, twilioNumber } = twilioConfig;
  
  // Encode Basic Authentication header
  const authHeader = "Basic " + btoa(`${accountSid}:${authToken}`);
  
  state.contacts.forEach(contact => {
    console.log(`📡 Sending Twilio background alert for: ${contact.name}`);
    
    // 1. Send automatic background SMS
    const smsBody = `ALERTIFY: EMERGENCY! Kushagri Sharma is in danger. Location address: ${state.resolvedAddress}. Track live coordinates here: ${mapsLink}`;
    
    const smsParams = new URLSearchParams();
    smsParams.append("To", contact.phone);
    smsParams.append("From", twilioNumber);
    smsParams.append("Body", smsBody);

    fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: smsParams
    })
    .then(res => res.json())
    .then(data => console.log(`Twilio SMS sent to ${contact.name}:`, data.sid || data.message))
    .catch(err => console.error(`Failed to send Twilio SMS to ${contact.name}:`, err));

    // 2. Place automatic voice call playing the automated speech
    const twimlCode = `<Response><Say voice="alice">Emergency! Kushagri Sharma has triggered an SOS alert and is in danger. Their location has been geocoded at ${state.resolvedAddress}. Please inspect your text messages immediately for their live Google Maps location tracking link. I repeat, check your messages to locate them. Goodbye.</Say></Response>`;
    
    const callParams = new URLSearchParams();
    callParams.append("To", contact.phone);
    callParams.append("From", twilioNumber);
    callParams.append("Twiml", twimlCode);

    fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: callParams
    })
    .then(res => res.json())
    .then(data => console.log(`Twilio Call placed to ${contact.name}:`, data.sid || data.message))
    .catch(err => console.error(`Failed to place Twilio Call to ${contact.name}:`, err));
  });
}

// Programmatically verify contact caller ID in Twilio REST API on the fly
function verifyNumberInTwilio(contact) {
  if (!navigator.onLine) {
    console.warn("Device is offline. Skipping Twilio caller ID verification.");
    return;
  }
  if (!isTwilioConfigured) {
    console.warn("Twilio is not configured. Skipping Twilio caller ID verification.");
    return;
  }

  const { accountSid, authToken } = twilioConfig;
  const authHeader = "Basic " + btoa(`${accountSid}:${authToken}`);

  console.log(`📡 Requesting Twilio caller ID verification for: ${contact.name} (${contact.phone})`);

  const params = new URLSearchParams();
  params.append("PhoneNumber", contact.phone);
  params.append("FriendlyName", contact.name);

  fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/OutgoingCallerIds.json`, {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  })
  .then(res => {
    if (!res.ok) {
      return res.json().then(errData => {
        throw new Error(errData.message || `HTTP error ${res.status}`);
      });
    }
    return res.json();
  })
  .then(data => {
    console.log("Twilio OutgoingCallerIds validation request success:", data);
    if (data.validation_code) {
      document.getElementById("verificationContactName").innerText = contact.name;
      document.getElementById("verificationContactPhone").innerText = contact.phone;
      document.getElementById("verificationCode").innerText = data.validation_code;
      document.getElementById("twilioVerificationModal").classList.remove("hidden");
    } else {
      console.warn("No validation code returned in Twilio response.", data);
    }
  })
  .catch(err => {
    console.error("Twilio caller ID verification failed:", err);
    alert(`Twilio caller ID verification failed: ${err.message}`);
  });
}

function updateGpsIndicators(statusStr) {
  const dashCoords = document.getElementById("dashCoords");
  const quickStatus = document.getElementById("quickStatus");
  const systemStatus = document.getElementById("systemStatus");
  
  const mapLat = document.getElementById("mapLat");
  const mapLng = document.getElementById("mapLng");
  const mapAccuracy = document.getElementById("mapAccuracy");

  // Render coords in dashboard and live maps panels
  if (dashCoords && statusStr === "Active") {
    dashCoords.innerText = `${state.currentCoords.lat.toFixed(5)}, ${state.currentCoords.lng.toFixed(5)}`;
  }
  
  if (mapLat && mapLng && mapAccuracy && statusStr === "Active") {
    mapLat.innerText = state.currentCoords.lat.toFixed(6);
    mapLng.innerText = state.currentCoords.lng.toFixed(6);
    mapAccuracy.innerText = `± ${state.gpsAccuracy.toFixed(1)} meters`;
  }

  // Visual status indicators
  if (quickStatus && systemStatus) {
    if (statusStr === "Active") {
      quickStatus.innerText = `GPS Ready (±${state.gpsAccuracy.toFixed(0)}m)`;
      systemStatus.innerHTML = `<span class="status-dot green"></span><span class="status-text">System Active</span>`;
    } else if (statusStr === "Error/Denied") {
      quickStatus.innerText = "GPS Error - Check Permissions";
      systemStatus.innerHTML = `<span class="status-dot orange"></span><span class="status-text">GPS Off</span>`;
    } else {
      quickStatus.innerText = "Connecting GPS...";
      systemStatus.innerHTML = `<span class="status-dot orange"></span><span class="status-text">Connecting</span>`;
    }
  }
}

// Geocoding Coordinates to Human-Readable Addresses
function reverseGeocodeCoordinates(lat, lng) {
  // 1. If Google Maps is loaded successfully, use its standard Geocoder
  if (state.mapEngine === "google" && typeof google !== "undefined" && google.maps.Geocoder) {
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (status === "OK" && results[0]) {
        state.resolvedAddress = results[0].formatted_address;
        updateAddressUI();
      } else {
        fallbackReverseGeocode(lat, lng);
      }
    });
  } else {
    // 2. Otherwise fall back to a public OSM reverse geocoding API
    fallbackReverseGeocode(lat, lng);
  }
}

// Fallback reverse geocoder utilizing open OSM Nominatim
function fallbackReverseGeocode(lat, lng) {
  fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`)
    .then(response => response.json())
    .then(data => {
      if (data && data.display_name) {
        state.resolvedAddress = data.display_name;
      } else {
        state.resolvedAddress = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      }
      updateAddressUI();
    })
    .catch(err => {
      console.warn("OSM geocoder failed, showing raw coords:", err);
      state.resolvedAddress = `Coordinates: Lat ${lat.toFixed(5)}, Lng ${lng.toFixed(5)}`;
      updateAddressUI();
    });
}

function updateAddressUI() {
  const addressText = document.getElementById("addressText");
  const alarmAddress = document.getElementById("alarmAddress");
  
  if (addressText) addressText.innerText = state.resolvedAddress;
  if (alarmAddress) alarmAddress.innerText = state.resolvedAddress;
}

// ==========================================
// 4. MAP MANAGER (GOOGLE MAPS & LEAFLET)
// ==========================================
function initMapManager() {
  // Check if Google Maps script loaded and API key is NOT the default placeholder
  const isGoogleKeyPlaceholder = document.querySelector('script[src*="YOUR_GOOGLE_MAPS_API_KEY"]') !== null;
  
  if (typeof google !== "undefined" && google.maps && !isGoogleKeyPlaceholder) {
    // Initialize standard Google Maps
    state.mapEngine = "google";
    console.log("🗺️ Initialize Google Maps API Engine.");
    initGoogleMaps();
  } else {
    // Initialize Leaflet/OpenStreetMap fallback
    state.mapEngine = "leaflet";
    console.warn("⚠️ Google Maps API Key placeholder detected or library offline. Activating Leaflet.js + OSM Engine.");
    loadLeafletMapEngine();
  }
}

// --- GOOGLE MAPS IMPLEMENTATION ---
function initGoogleMaps() {
  const mapElement = document.getElementById("googleMap");
  const placesMapElement = document.getElementById("placesMap");
  
  if (!mapElement || !placesMapElement) return;

  const mapOptions = {
    center: state.currentCoords,
    zoom: 15,
    mapId: "alertify_map",
    disableDefaultUI: false,
    styles: [
      { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
      { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
      { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
      {
        featureType: "administrative.locality",
        elementType: "labels.text.fill",
        stylers: [{ color: "#d59563" }]
      },
      {
        featureType: "poi",
        elementType: "labels.text.fill",
        stylers: [{ color: "#d59563" }]
      },
      {
        featureType: "road",
        elementType: "geometry",
        stylers: [{ color: "#38414e" }]
      },
      {
        featureType: "road",
        elementType: "geometry.stroke",
        stylers: [{ color: "#212a37" }]
      },
      {
        featureType: "road",
        elementType: "labels.text.fill",
        stylers: [{ color: "#9ca5b3" }]
      },
      {
        featureType: "water",
        elementType: "geometry",
        stylers: [{ color: "#17263c" }]
      }
    ]
  };

  // Create Main Map
  state.mainMap = new google.maps.Map(mapElement, mapOptions);
  
  // Custom styled pulsing marker for user location
  state.mainMarker = new google.maps.Marker({
    position: state.currentCoords,
    map: state.mainMap,
    title: "My Location",
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 10,
      fillColor: "#ef4444",
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 2
    }
  });

  // Create Nearby Places Map
  state.placesMap = new google.maps.Map(placesMapElement, {
    ...mapOptions,
    zoom: 14
  });

  state.placesMarker = new google.maps.Marker({
    position: state.currentCoords,
    map: state.placesMap,
    title: "My Location",
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 10,
      fillColor: "#ef4444",
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 2
    }
  });

  // Trigger Nearby places fetch on load
  google.maps.event.addListenerOnce(state.placesMap, 'idle', () => {
    fetchNearbyPlacesGoogle(state.currentPlaceType);
  });
}

// --- LEAFLET / OPENSTREETMAP FALLBACK ENGINE ---
function loadLeafletMapEngine() {
  // Dynamically inject Leaflet stylesheet
  const cssLink = document.createElement("link");
  cssLink.rel = "stylesheet";
  cssLink.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  cssLink.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
  cssLink.crossOrigin = "";
  document.head.appendChild(cssLink);

  // Dynamically inject Leaflet JavaScript code
  const scriptTag = document.createElement("script");
  scriptTag.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
  scriptTag.integrity = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
  scriptTag.crossOrigin = "";
  
  scriptTag.onload = () => {
    console.log("✅ Leaflet.js loaded successfully.");
    initLeafletMaps();
  };

  document.head.appendChild(scriptTag);
}

function initLeafletMaps() {
  const mapElement = document.getElementById("googleMap");
  const placesMapElement = document.getElementById("placesMap");

  if (!mapElement || !placesMapElement) return;

  // Clear map containers from fallback placeholder layout
  mapElement.innerHTML = "";
  placesMapElement.innerHTML = "";

  // 1. Initialize Main Map
  state.mainMap = L.map(mapElement).setView([state.currentCoords.lat, state.currentCoords.lng], 15);
  
  // Apply a beautiful dark theme tile layout from CartoDB
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(state.mainMap);

  // User location marker
  const redMarkerIcon = L.divIcon({
    className: 'leaflet-red-pulse-marker',
    html: `<div style="background-color: #ef4444; width: 14px; height: 14px; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 10px #ef4444;"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });

  state.mainMarker = L.marker([state.currentCoords.lat, state.currentCoords.lng], { icon: redMarkerIcon }).addTo(state.mainMap);
  state.mainMarker.bindPopup("<b>You are here</b><br>Accuracy: " + state.gpsAccuracy.toFixed(0) + "m").openPopup();

  // 2. Initialize Places Map
  state.placesMap = L.map(placesMapElement).setView([state.currentCoords.lat, state.currentCoords.lng], 14);
  
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>'
  }).addTo(state.placesMap);

  state.placesMarker = L.marker([state.currentCoords.lat, state.currentCoords.lng], { icon: redMarkerIcon }).addTo(state.placesMap);

  // Trigger fallback places calculation
  fetchNearbyPlacesFallback(state.currentPlaceType);
}

// --- MAP SYNC HELPERS ---
function updateMapPositions() {
  if (!state.mainMap) return;

  if (state.mapEngine === "google" && typeof google !== "undefined") {
    const latLng = new google.maps.LatLng(state.currentCoords.lat, state.currentCoords.lng);
    
    // Update main marker and map center
    if (state.mainMarker) state.mainMarker.setPosition(latLng);
    if (state.activeTab === "map-section") {
      state.mainMap.panTo(latLng);
    }

    // Update places marker
    if (state.placesMarker) state.placesMarker.setPosition(latLng);
    
  } else if (state.mapEngine === "leaflet" && typeof L !== "undefined") {
    // Update main marker and map center
    if (state.mainMarker) {
      state.mainMarker.setLatLng([state.currentCoords.lat, state.currentCoords.lng]);
      state.mainMarker.setPopupContent("<b>You are here</b><br>Accuracy: " + state.gpsAccuracy.toFixed(0) + "m");
    }
    if (state.activeTab === "map-section") {
      state.mainMap.panTo([state.currentCoords.lat, state.currentCoords.lng]);
    }

    // Update places marker
    if (state.placesMarker) {
      state.placesMarker.setLatLng([state.currentCoords.lat, state.currentCoords.lng]);
    }
  }
}

// ==========================================
// 5. EMERGENCY SOS CONTROLLER
// ==========================================
function startSosCountdown() {
  // Reset countdown
  state.sosCountdownValue = 3;
  document.getElementById("countdownTimer").innerText = state.sosCountdownValue;
  
  // Show modal
  const countdownModal = document.getElementById("countdownModal");
  countdownModal.classList.remove("hidden");

  // Play a soft ticking audio beep if supported
  playBeepSound(400, 0.1);

  // Start Interval timer
  state.sosCountdownTimer = setInterval(() => {
    state.sosCountdownValue--;
    
    if (state.sosCountdownValue > 0) {
      document.getElementById("countdownTimer").innerText = state.sosCountdownValue;
      playBeepSound(400, 0.1);
    } else {
      // Countdown finished! Trigger full alarm
      clearInterval(state.sosCountdownTimer);
      countdownModal.classList.add("hidden");
      triggerSosEmergency();
    }
  }, 1000);
}

function cancelSosCountdown() {
  if (state.sosCountdownTimer) {
    clearInterval(state.sosCountdownTimer);
    state.sosCountdownTimer = null;
  }
  document.getElementById("countdownModal").classList.add("hidden");
  console.log("Emergency alert canceled by user.");
}

function triggerSosEmergency() {
  state.isAlarmActive = true;
  
  // Update header status
  const systemStatus = document.getElementById("systemStatus");
  if (systemStatus) {
    systemStatus.innerHTML = `<span class="status-dot red"></span><span class="status-text text-red">SOS ALERT ACTIVE</span>`;
  }

  // Create Maps link
  const mapsLink = `https://www.google.com/maps?q=${state.currentCoords.lat},${state.currentCoords.lng}`;
  
  // Create history log object
  const alertLog = {
    timestamp: Date.now(),
    latitude: state.currentCoords.lat,
    longitude: state.currentCoords.lng,
    address: state.resolvedAddress,
    mapLink: mapsLink
  };

  // Push to Firebase/LocalStorage logs
  logAlertToStorage(alertLog);
  
  // Set UI stats updating
  const dashLastAlert = document.getElementById("dashLastAlert");
  if (dashLastAlert) {
    dashLastAlert.innerText = new Date(alertLog.timestamp).toLocaleTimeString();
  }

  // Show Alarm Overlay
  document.getElementById("alarmLat").innerText = state.currentCoords.lat.toFixed(6);
  document.getElementById("alarmLng").innerText = state.currentCoords.lng.toFixed(6);
  document.getElementById("alarmMapsLink").setAttribute("href", mapsLink);
  document.getElementById("activeAlarmOverlay").classList.remove("hidden");

  // Render contacts SMS triggers inside alarm overlay
  renderAlarmContactsGrid(mapsLink);

  // Play continuous siren sound loop
  startSirenSoundLoop();

  // Stream initial coordinate values
  updateActiveSosCoordinates();

  // Dispatch alerts based on network state and Twilio configurations
  const isOnline = navigator.onLine;
  if (isOnline && isTwilioConfigured) {
    // Cloud Mode: Background automatic calls and texts
    triggerTwilioAlerts(mapsLink);
  } else {
    // Offline/Fallback Mode: Launch OS-specific native SMS dialer
    if (state.contacts.length > 0) {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      const separator = isIOS ? ';' : ',';
      const allPhones = state.contacts.map(c => c.phone).join(separator);
      
      const emergencyMessage = `EMERGENCY! I need assistance. My current GPS location address is: ${state.resolvedAddress}. Track me live on Google Maps here: ${mapsLink}`;
      const escapedMsg = encodeURIComponent(emergencyMessage);
      const smsLink = isIOS 
        ? `sms:${allPhones};&body=${escapedMsg}` 
        : `sms:${allPhones}?body=${escapedMsg}`;
      
      setTimeout(() => {
        console.log(`Auto-launching multi-contact SMS dialer for: ${allPhones}`);
        window.location.href = smsLink;
      }, 600);
    }
  }
}

function stopSosEmergency() {
  state.isAlarmActive = false;
  
  // Clear active tracking node
  if (!isFirebasePlaceholder && db) {
    const sosRef = ref(db, `devices/${state.deviceId}/active_sos`);
    set(sosRef, null);
  } else {
    localStorage.removeItem("alertify_active_sos");
  }
  
  // Reset header status
  updateGpsIndicators("Active");
  
  // Close active overlay
  document.getElementById("activeAlarmOverlay").classList.add("hidden");
  
  // Terminate siren sound
  stopSirenSoundLoop();
  console.log("SOS alarm marked safe. System returned to active scanning.");
}

// Siren Alarm sound synthesizers using browser AudioContext (Zero external files needed)
let audioCtx = null;
let sirenOsc1 = null;
let sirenOsc2 = null;
let sirenGain = null;
let sirenInterval = null;

function playBeepSound(frequency, duration) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    osc.type = "sine";
    osc.frequency.value = frequency;
    gainNode.gain.setValueAtTime(0.2, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn("AudioContext block by browser permissions:", e);
  }
}

function startSirenSoundLoop() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sirenOsc1 = audioCtx.createOscillator();
    sirenOsc2 = audioCtx.createOscillator();
    sirenGain = audioCtx.createGain();

    sirenOsc1.type = "sawtooth";
    sirenOsc2.type = "sine";
    
    sirenOsc1.frequency.value = 600; // Police tone starting freq
    sirenOsc2.frequency.value = 5;   // Modulation speed (Hz)
    
    const modGain = audioCtx.createGain();
    modGain.gain.value = 150;        // Frequency swing range (Hz)
    
    // Connect modulator to oscillator frequency
    sirenOsc2.connect(modGain);
    modGain.connect(sirenOsc1.frequency);
    
    // Connect output
    sirenOsc1.connect(sirenGain);
    sirenGain.connect(audioCtx.destination);
    
    sirenGain.gain.setValueAtTime(0.15, audioCtx.currentTime); // Siren volume
    
    sirenOsc1.start();
    sirenOsc2.start();
  } catch (e) {
    console.warn("Siren synthesis failed:", e);
  }
}

function stopSirenSoundLoop() {
  if (sirenOsc1) {
    try {
      sirenOsc1.stop();
      sirenOsc2.stop();
    } catch(e){}
    sirenOsc1 = null;
    sirenOsc2 = null;
  }
  if (audioCtx) {
    try {
      audioCtx.close();
    } catch(e){}
    audioCtx = null;
  }
}

// ==========================================
// 6. EMERGENCY CONTACTS VIEW CONTROLLER
// ==========================================
function renderContacts() {
  const container = document.getElementById("contactsContainer");
  if (!container) return;

  if (state.contacts.length === 0) {
    container.innerHTML = `
      <div class="no-data">
        <i class="fa-solid fa-user-shield fa-2x text-muted"></i>
        <p>No contacts saved yet.</p>
      </div>`;
    return;
  }

  container.innerHTML = "";
  state.contacts.forEach(contact => {
    const card = document.createElement("div");
    card.className = "contact-item-card";

    // Show verify button only if Twilio is configured
    const verifyBtnHtml = isTwilioConfigured 
      ? `<button class="btn-verify-contact" data-id="${contact.id}" title="Verify in Twilio" style="color: #3b82f6; margin-right: 0.5rem; background: rgba(59, 130, 246, 0.1); border-radius: 8px; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.2s ease;">
          <i class="fa-solid fa-phone-volume"></i>
         </button>`
      : "";

    card.innerHTML = `
      <div class="contact-details">
        <div class="contact-name-row">
          <span class="contact-name">${escapeHTML(contact.name)}</span>
          <span class="contact-badge">${escapeHTML(contact.relationship)}</span>
        </div>
        <span class="contact-phone"><i class="fa-solid fa-phone-flip text-muted"></i> ${escapeHTML(contact.phone)}</span>
      </div>
      <div class="contact-actions" style="display: flex; align-items: center;">
        ${verifyBtnHtml}
        <button class="btn-delete-contact" data-id="${contact.id}" title="Remove Contact">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>`;
    
    // Wire up verify event listener if it exists
    const verifyBtn = card.querySelector(".btn-verify-contact");
    if (verifyBtn) {
      verifyBtn.addEventListener("click", () => {
        verifyNumberInTwilio(contact);
      });
      verifyBtn.addEventListener("mouseenter", () => {
        verifyBtn.style.background = "rgba(59, 130, 246, 0.25)";
      });
      verifyBtn.addEventListener("mouseleave", () => {
        verifyBtn.style.background = "rgba(59, 130, 246, 0.1)";
      });
    }

    // Wire up delete event listener
    card.querySelector(".btn-delete-contact").addEventListener("click", (e) => {
      const contactId = e.currentTarget.getAttribute("data-id");
      if (confirm("Are you sure you want to remove this emergency contact?")) {
        deleteContactFromStorage(contactId);
      }
    });

    container.appendChild(card);
  });
}

function renderAlarmContactsGrid(mapsLink) {
  const alarmContactsList = document.getElementById("alarmContactsList");
  if (!alarmContactsList) return;

  if (state.contacts.length === 0) {
    alarmContactsList.innerHTML = `
      <div class="text-center text-muted card glass-card" style="padding: 1rem;">
        <i class="fa-solid fa-user-slash fa-lg"></i>
        <p style="margin-top:0.5rem; font-size:0.85rem;">No contacts saved. Please add trusted contacts in the App Directory.</p>
      </div>`;
    return;
  }

  alarmContactsList.innerHTML = "";
  state.contacts.forEach(contact => {
    // Dynamic text bodies
    const emergencyMessage = `EMERGENCY! I need assistance. My current GPS location address is: ${state.resolvedAddress}. Track me live on Google Maps here: ${mapsLink}`;
    const escapedMsg = encodeURIComponent(emergencyMessage);

    const row = document.createElement("div");
    row.className = "alarm-contact-row";
    row.innerHTML = `
      <div class="alarm-contact-details">
        <span class="alarm-contact-name">${escapeHTML(contact.name)} (${escapeHTML(contact.relationship)})</span>
      </div>
      <div class="alarm-contact-actions">
        <a href="tel:${contact.phone}" class="btn-alarm-action btn-alarm-call" title="Call ${escapeHTML(contact.name)}">
          <i class="fa-solid fa-phone"></i>
        </a>
        <a href="sms:${contact.phone}?&body=${escapedMsg}" class="btn-alarm-action btn-alarm-sms sms-link" title="Text ${escapeHTML(contact.name)}">
          <i class="fa-solid fa-comment-sms"></i>
        </a>
      </div>`;
    
    // Correct SMS query parameters dynamically based on UserAgent strings (iOS vs Android separator)
    const smsBtn = row.querySelector(".sms-link");
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) {
      smsBtn.setAttribute("href", `sms:${contact.phone};&body=${escapedMsg}`);
    } else {
      smsBtn.setAttribute("href", `sms:${contact.phone}?body=${escapedMsg}`);
    }

    alarmContactsList.appendChild(row);
  });
}

// ==========================================
// 7. NEARBY SAFE PLACES MANAGER
// ==========================================

// Main tab click routers for places filters
const filterTabs = document.querySelectorAll(".filter-tab");
filterTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    filterTabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    state.currentPlaceType = tab.getAttribute("data-type");

    if (state.mapEngine === "google") {
      fetchNearbyPlacesGoogle(state.currentPlaceType);
    } else {
      fetchNearbyPlacesFallback(state.currentPlaceType);
    }
  });
});

// --- FETCH NEARBY PLACES WITH GOOGLE PLACES API ---
function fetchNearbyPlacesGoogle(type) {
  if (typeof google === "undefined" || !state.placesMap) return;

  const placesList = document.getElementById("placesList");
  placesList.innerHTML = `<div class="text-center text-muted" style="padding: 3rem;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top: 1rem;">Searching nearby ${type}s...</p></div>`;

  // Map Google place types
  let googleType = "hospital";
  if (type === "police") googleType = "police";
  if (type === "pharmacy") googleType = "pharmacy";

  const request = {
    location: state.currentCoords,
    radius: 3000, // 3km search radius
    type: [googleType]
  };

  const service = new google.maps.places.PlacesService(state.placesMap);
  service.nearbySearch(request, (results, status) => {
    // Clear previous markers
    clearPlaceMarkers();

    if (status === google.maps.places.PlacesServiceStatus.OK && results) {
      renderSafePlacesList(results, "google");
      
      // Plot markers on Places Map
      results.forEach(place => {
        const marker = new google.maps.Marker({
          position: place.geometry.location,
          map: state.placesMap,
          title: place.name,
          icon: {
            url: getPlaceIconUrl(type),
            scaledSize: new google.maps.Size(30, 30)
          }
        });
        
        // Add info bubble click handling
        const infoWindow = new google.maps.InfoWindow({
          content: `<strong>${place.name}</strong><br>${place.vicinity}`
        });
        marker.addListener("click", () => {
          infoWindow.open(state.placesMap, marker);
        });

        state.placeMarkers.push(marker);
      });
    } else {
      placesList.innerHTML = `
        <div class="no-data">
          <i class="fa-solid fa-face-frown fa-2x"></i>
          <p>No nearby ${type}s found inside 3km radius.</p>
        </div>`;
    }
  });
}

// Clean previous pins
function clearPlaceMarkers() {
  if (state.mapEngine === "google") {
    state.placeMarkers.forEach(m => m.setMap(null));
  } else if (state.mapEngine === "leaflet") {
    state.placeMarkers.forEach(m => state.placesMap.removeLayer(m));
  }
  state.placeMarkers = [];
}

// --- FETCH NEARBY PLACES WITH STATIC MOCK GENERATOR (OSM Fallback) ---
function fetchNearbyPlacesFallback(type) {
  const placesList = document.getElementById("placesList");
  placesList.innerHTML = `<div class="text-center text-muted" style="padding: 2rem;"><i class="fa-solid fa-spinner fa-spin fa-lg"></i><p>Scanning coordinates...</p></div>`;

  setTimeout(() => {
    clearPlaceMarkers();
    
    // Generate realistic relative safe spots mathematically offset from user coordinates
    const mocks = getMockPlaces(state.currentCoords.lat, state.currentCoords.lng, type);
    renderSafePlacesList(mocks, "leaflet");

    if (state.mapEngine === "leaflet" && typeof L !== "undefined") {
      mocks.forEach(place => {
        const markerIcon = L.divIcon({
          className: 'leaflet-place-marker',
          html: `<div style="background-color: ${getPlaceColor(type)}; width: 12px; height: 12px; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 8px ${getPlaceColor(type)};"></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6]
        });

        const marker = L.marker([place.geometry.location.lat, place.geometry.location.lng], { icon: markerIcon }).addTo(state.placesMap);
        marker.bindPopup(`<b>${place.name}</b><br>${place.vicinity}`);
        state.placeMarkers.push(marker);
      });
      
      // Auto-fit places map bounds to encapsulate coordinates + fallback markers
      const group = L.featureGroup([state.placesMarker, ...state.placeMarkers]);
      state.placesMap.fitBounds(group.getBounds().pad(0.15));
    }
  }, 400);
}

// Mock places geo offsets
function getMockPlaces(lat, lng, type) {
  const dataset = {
    hospital: [
      { name: "Metro General Hospital & Trauma Center", offsetLat: 0.004, offsetLng: -0.005, rating: 4.5, open: true, phone: "+1 555-0101" },
      { name: "St. Jude Safety Emergency Clinic", offsetLat: -0.006, offsetLng: 0.008, rating: 4.2, open: true, phone: "+1 555-0102" },
      { name: "City Care Red Cross Hospital", offsetLat: 0.009, offsetLng: 0.002, rating: 4.7, open: false, phone: "+1 555-0103" }
    ],
    police: [
      { name: "Central Police Station Command HQ", offsetLat: -0.003, offsetLng: -0.003, rating: 4.1, open: true, phone: "+1 555-0201" },
      { name: "Metropolitan Safety Outpost", offsetLat: 0.005, offsetLng: 0.006, rating: 4.4, open: true, phone: "+1 555-0202" },
      { name: "District Police Precinct 4", offsetLat: -0.008, offsetLng: -0.007, rating: 3.9, open: true, phone: "+1 555-0203" }
    ],
    pharmacy: [
      { name: "24/7 Red Cross Pharmacy", offsetLat: 0.002, offsetLng: 0.002, rating: 4.6, open: true, phone: "+1 555-0301" },
      { name: "Beacon Emergency Chemist", offsetLat: -0.002, offsetLng: -0.004, rating: 4.3, open: true, phone: "+1 555-0302" },
      { name: "Apex Medicare & Drug Store", offsetLat: 0.006, offsetLng: -0.008, rating: 4.0, open: false, phone: "+1 555-0303" }
    ]
  };

  const results = dataset[type] || [];
  return results.map((item, idx) => {
    const itemLat = lat + item.offsetLat;
    const itemLng = lng + item.offsetLng;
    
    // Calculate distance using simple Pythagorean approximation (sufficient for small geo bounds)
    const dy = (itemLat - lat) * 111; // 111km per deg lat
    const dx = (itemLng - lng) * 111 * Math.cos(lat * Math.PI / 180);
    const distanceKm = Math.sqrt(dx*dx + dy*dy);

    return {
      place_id: `${type}_mock_${idx}`,
      name: item.name,
      vicinity: `Approx. ${distanceKm.toFixed(2)} km away, City Coordinates Area`,
      rating: item.rating,
      phone: item.phone,
      opening_hours: { open_now: item.open },
      geometry: {
        location: { lat: itemLat, lng: itemLng }
      },
      distance: distanceKm
    };
  });
}

function getPlaceColor(type) {
  if (type === "hospital") return "#ef4444";
  if (type === "police") return "#3b82f6";
  return "#10b981"; // pharmacy
}

function getPlaceIconUrl(type) {
  // Return small stylized markers
  if (type === "hospital") return "https://maps.google.com/mapfiles/ms/icons/red-dot.png";
  if (type === "police") return "https://maps.google.com/mapfiles/ms/icons/blue-dot.png";
  return "https://maps.google.com/mapfiles/ms/icons/green-dot.png";
}

// Render dynamic elements to panels
function renderSafePlacesList(places, engine) {
  const container = document.getElementById("placesList");
  if (!container) return;

  container.innerHTML = "";
  
  // Sort by distance (if distance value exists)
  if (places[0] && places[0].distance !== undefined) {
    places.sort((a, b) => a.distance - b.distance);
  }

  places.forEach(place => {
    const card = document.createElement("div");
    card.className = "place-item-card";
    
    // Safe extract rating
    const ratingStr = place.rating ? `<span class="place-rating-badge"><i class="fa-solid fa-star"></i> ${place.rating}</span>` : "";
    
    // Safe extract open status
    let openStatusHtml = `<span class="place-open"><i class="fa-solid fa-circle-check"></i> Open</span>`;
    if (place.opening_hours && place.opening_hours.open_now === false) {
      openStatusHtml = `<span class="place-closed"><i class="fa-solid fa-circle-xmark"></i> Closed</span>`;
    }

    const itemLat = engine === "google" ? place.geometry.location.lat() : place.geometry.location.lat;
    const itemLng = engine === "google" ? place.geometry.location.lng() : place.geometry.location.lng;
    const mapDirectionsLink = `https://www.google.com/maps/dir/?api=1&origin=${state.currentCoords.lat},${state.currentCoords.lng}&destination=${itemLat},${itemLng}&travelmode=walking`;

    card.innerHTML = `
      <div class="place-header-row">
        <span class="place-name">${escapeHTML(place.name)}</span>
        ${ratingStr}
      </div>
      <p class="place-address"><i class="fa-solid fa-location-dot text-muted"></i> ${escapeHTML(place.vicinity)}</p>
      <div class="place-status-strip">
        ${openStatusHtml}
        <a href="${mapDirectionsLink}" target="_blank" class="btn btn-secondary btn-sm">
          <i class="fa-solid fa-diamond-turn-right text-red"></i> Directions
        </a>
      </div>`;
    
    container.appendChild(card);
  });
}

// ==========================================
// 8. LOGS & ALERTS HISTORY
// ==========================================
function renderHistory() {
  const container = document.getElementById("historyTableContainer");
  if (!container) return;

  if (state.history.length === 0) {
    container.innerHTML = `
      <div class="no-data">
        <i class="fa-solid fa-folder-open fa-2x text-muted"></i>
        <p>No history logs logged yet.</p>
      </div>`;
    return;
  }

  const tableHTML = `
    <table class="history-table">
      <thead>
        <tr>
          <th>Time / Date</th>
          <th>Location Coords</th>
          <th>Physical Address</th>
          <th>Navigation</th>
        </tr>
      </thead>
      <tbody id="historyTableBody">
      </tbody>
    </table>`;
  
  container.innerHTML = tableHTML;
  const tbody = document.getElementById("historyTableBody");

  state.history.forEach(log => {
    const row = document.createElement("tr");
    const dateObj = new Date(log.timestamp);
    const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    
    row.innerHTML = `
      <td>
        <span class="history-time">${timeStr}</span>
        <span class="history-date">${dateStr}</span>
      </td>
      <td class="history-coords">
        ${log.latitude.toFixed(5)}, ${log.longitude.toFixed(5)}
      </td>
      <td class="place-address">
        ${escapeHTML(log.address || "Unknown Address Location")}
      </td>
      <td>
        <a href="${log.mapLink}" target="_blank" class="btn btn-secondary btn-sm" style="display:inline-flex;">
          <i class="fa-solid fa-up-right-from-square"></i> Open Map
        </a>
      </td>`;
    
    tbody.appendChild(row);
  });
}

function updateDashboardStats() {
  const dashContactsCount = document.getElementById("dashContactsCount");
  const dashLastAlert = document.getElementById("dashLastAlert");

  if (dashContactsCount) {
    dashContactsCount.innerText = state.contacts.length === 1 
      ? "1 Contact Saved" 
      : `${state.contacts.length} Contacts Saved`;
  }

  if (dashLastAlert && state.history.length > 0) {
    const lastAlertTime = new Date(state.history[0].timestamp);
    dashLastAlert.innerText = `${lastAlertTime.toLocaleDateString()} ${lastAlertTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
  }
}

// ==========================================
// 9. EVENT BINDINGS
// ==========================================
function setupEventListeners() {
  // Primary SOS Button (Press Trigger)
  const sosBtn = document.getElementById("sosBtn");
  if (sosBtn) {
    sosBtn.addEventListener("click", () => {
      startSosCountdown();
    });
  }

  // Cancel SOS Button
  const cancelSosBtn = document.getElementById("cancelSosBtn");
  if (cancelSosBtn) {
    cancelSosBtn.addEventListener("click", () => {
      cancelSosCountdown();
    });
  }

  // Stop SOS Alarm
  const stopAlarmBtn = document.getElementById("stopAlarmBtn");
  if (stopAlarmBtn) {
    stopAlarmBtn.addEventListener("click", () => {
      stopSosEmergency();
    });
  }

  // Save Contact Form Submission
  const contactForm = document.getElementById("contactForm");
  if (contactForm) {
    contactForm.addEventListener("submit", (e) => {
      e.preventDefault();
      
      const newContact = {
        name: document.getElementById("contactName").value.trim(),
        phone: document.getElementById("contactPhone").value.trim(),
        relationship: document.getElementById("contactRelation").value
      };

      saveContactToStorage(newContact);
      verifyNumberInTwilio(newContact);
      
      // Reset Form UI
      contactForm.reset();
      console.log("Contact successfully added.");
    });
  }

  // Manual Geolocation Tracker Refresher
  const refreshLocationBtn = document.getElementById("refreshLocationBtn");
  if (refreshLocationBtn) {
    refreshLocationBtn.addEventListener("click", () => {
      const originalText = refreshLocationBtn.innerHTML;
      refreshLocationBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Locating...`;
      refreshLocationBtn.disabled = true;

      navigator.geolocation.getCurrentPosition(
        (position) => {
          state.currentCoords.lat = position.coords.latitude;
          state.currentCoords.lng = position.coords.longitude;
          state.gpsAccuracy = position.coords.accuracy;

          updateGpsIndicators("Active");
          reverseGeocodeCoordinates(state.currentCoords.lat, state.currentCoords.lng);
          updateMapPositions();
          
          refreshLocationBtn.innerHTML = originalText;
          refreshLocationBtn.disabled = false;
        },
        (error) => {
          console.error("Manual GPS Refresh error:", error);
          refreshLocationBtn.innerHTML = originalText;
          refreshLocationBtn.disabled = false;
          alert(`Failed to update location: ${error.message}`);
        },
        { enableHighAccuracy: true, timeout: 5000 }
      );
    });
  }

  // Delete History database log items
  const clearHistoryBtn = document.getElementById("clearHistoryBtn");
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener("click", () => {
      if (confirm("Are you sure you want to clear your entire SOS activity history log?")) {
        clearHistoryFromStorage();
      }
    });
  }

  // Close Twilio Verification Modal
  const closeVerificationBtn = document.getElementById("closeVerificationBtn");
  if (closeVerificationBtn) {
    closeVerificationBtn.addEventListener("click", () => {
      document.getElementById("twilioVerificationModal").classList.add("hidden");
    });
  }
}

// ==========================================
// 10. SANITIZER HELPER METHODS
// ==========================================
function escapeHTML(str) {
  if (!str) return "";
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}
