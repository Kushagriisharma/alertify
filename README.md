# Alertify – SOS Emergency Application

Alertify is a high-availability, responsive, and emergency-focused Web SOS application designed for rapid incident signaling and real-time location sharing. In times of crisis, Alertify enables users to instantly capture their exact GPS coordinates, log incident reports in the cloud, and dispatch visual map navigation bridges to their emergency contacts.

Developed as a modern, resume-ready frontend showcase, the project boasts premium dark-mode aesthetics, responsive CSS grids, double-pulse interactive animations, and a **seamless offline/local fallback**. If Firebase credentials or Google Map APIs are unconfigured, the application gracefully activates LocalStorage repositories and injects interactive OpenStreetMap widgets.

---

## 🚀 Key Features

* **Instant SOS Signaling:** A large, pulse-animating central SOS button equipped with a 3-second countdown buffer to prevent accidental triggers.
* **Live GPS Positioning:** Leverages the HTML5 Geolocation API to continuously monitor coordinates (latitude, longitude, and accuracy radius).
* **Smart Reverse Geocoding:** Automatically resolves GPS coordinates into human-readable street addresses using Google Geocoding or fallback open APIs.
* **Hybrid Map Rendering:** Displays live positioning using **Google Maps JavaScript API**. If key credentials are empty, the app dynamically loads **Leaflet.js + CartoDB Dark Tiles** to present a fully interactive open-source map.
* **Trusted Contact Directory:** CRUD dashboard allowing users to save multiple emergency contacts (Name, Phone, Relationship) synced globally or saved locally.
* **Direct Emergency Triggers:** Generates custom SMS and phone call protocols dynamically matching the user's current GPS location with pre-filled message templates.
* **Nearby Safe Places Locator:** Displays nearby hospitals, police stations, and pharmacies using **Google Places API** or a mathematical geo-distance mockup generator for offline operations.
* **SOS Activity Log:** Keeps a detailed chronological journal of triggered alerts and exact coordinates, available to review or clear at any time.

---

## 🛠️ Tech Stack

* **Frontend Structure:** HTML5 (Semantic elements, modern viewports)
* **Design & Layout:** Custom Vanilla CSS3 (Custom properties, CSS Grids/Flexbox, glassmorphic filters, pulse overlays, hardware-accelerated animations)
* **Logic & APIs:** JavaScript ES6 (ES Modules, Dynamic Imports, Web Audio API, Geolocation API)
* **Database & Cloud Synchronization:** Firebase Realtime Database (SDK v10 CDN integration)
* **Map Services:** Google Maps JS SDK (Geocoding & Places Library) + Leaflet.js (OpenStreetMap engine fallback)
* **PWA offline support:** Service Worker caching strategies & Web App manifest configurations

---

## 📁 Project Directory Structure

```text
alertify/
│
├── index.html          # Core HTML layout & UI views
├── style.css           # Styling system & animations
├── script.js           # Geolocation, mapping, PWA register, & business logic
├── firebase.js         # Firebase initialization & modular exports
├── manifest.json       # PWA Application descriptor
├── sw.js               # Service Worker offline asset cacher
├── README.md           # Developer documentation & guide
└── assets/
    └── logo.png        # High-definition emergency-themed logo
```

---

## 💻 Local Development Setup

To run this application locally, you do not need complex build tools or compilers. Simply follow these steps:

### 1. Clone the Codebase
Clone this repository to your local system:
```bash
git clone https://github.com/Kushagriisharma/alertify.git
cd alertify
```

### 2. Launch Local Server
Because Alertify utilizes ES Modules (`import/export` syntax) and browser Geolocation APIs, running the application over the `file://` protocol may cause security blocks. Run it using a local HTTP server:

* **Using Python:**
  ```bash
  python -m http.server 8000
  ```
* **Using Node.js (http-server):**
  ```bash
  npx http-server -p 8000
  ```
* **Using VS Code Live Server:**
  Right-click `index.html` and select **"Open with Live Server"**.

Access the app in your browser at: `http://localhost:8000`.

---

## ⚙️ Configuration Instructions

### 1. Firebase Configuration Set Up

To connect the application to your cloud database:

1. Visit the [Firebase Console](https://console.firebase.google.com/) and create a new project named **Alertify**.
2. Add a new **Web App** to your project.
3. Enable **Realtime Database** from the Firebase left sidebar menu. 
4. Select a location close to you, choose **Start in test mode** (allows rapid prototyping, though you should configure security rules before publishing for production), and click Enable.
5. Copy your application's Web Config object credentials.
6. Open [firebase.js](file:///d:/alertify/firebase.js) in your text editor.
7. Locate the `firebaseConfig` object and replace the placeholder credentials with your actual project keys:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_ACTUAL_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```
Once configured, the app will automatically toggle from "Local Mode" to Cloud Database Sync.

### 2. Google Maps API Configuration Set Up

To initialize Google Map renders and Places searches:

1. Visit the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project and head to the **API Library**.
3. Enable the **Maps JavaScript API**, **Geocoding API**, and **Places API**.
4. Create an API Key in the **Credentials** tab.
5. Open [index.html](file:///d:/alertify/index.html).
6. Locate the Google Maps script tag near the bottom of the body section:
   ```html
   <script src="https://maps.googleapis.com/maps/api/js?key=YOUR_GOOGLE_MAPS_API_KEY&libraries=places" async defer></script>
   ```
7. Replace `YOUR_GOOGLE_MAPS_API_KEY` with your actual Google Cloud API key.

---

## 🚀 Deploiment Instructions (GitHub Pages)

### 1. Push Code to GitHub
Initialize your Git repository, commit files, and upload them to your GitHub profile. Execute these commands in your project terminal:

```bash
git init
git add .
git commit -m "Initial commit - Alertify SOS Emergency App"
git branch -M main
git remote add origin https://github.com/Kushagriisharma/alertify.git
git push -u origin main
```

### 2. Enable GitHub Pages Hosting
1. Navigate to your repository page on [GitHub](https://github.com).
2. Click on the **Settings** tab.
3. Select **Pages** from the left navigation panel under the "Code and automation" heading.
4. Locate the **Build and deployment** section.
5. Set the Source dropdown menu to **"Deploy from a branch"**.
6. Set the Branch dropdown menu to **`main`** and the directory path selector to **`/ (root)`**.
7. Click the **Save** button.
8. Your generated live URL is: **`https://kushagriisharma.github.io/alertify/`**

---

## 📶 Offline PWA Capabilities & Auto-SMS Redirection

Alertify is designed to be highly reliable during worst-case emergency scenarios, including **no network / no data coverage zones**. 

### 1. Offline Mode Execution
- **Cache Storage:** A background Service Worker (`sw.js`) pre-caches index.html, style.css, script.js, logos, and CDNs (Leaflet map files, font engines). Once opened on a device once, the application will load instantly without any network connection.
- **Local Fallback Engine:** If offline, the application seamlessly bypasses the Cloud database and stores contacts and coordinates directly in your browser's persistent `LocalStorage`.
- **GPS Satellite Triangulation:** Browsers compute Geolocation using the device's physical GPS hardware sensors. This does not require active mobile data, meaning your coordinates will update even in remote wilderness areas.

### 2. Auto-SMS Protocol Redirection
- **Sandbox Limitation:** Modern browsers prevent websites from programmatically sending SMS messages silently without user interaction for security reasons.
- **Auto-Launcher:** To bypass this and speed up emergency signaling, when the SOS countdown reaches zero, Alertify immediately compiles an emergency message containing your live coordinates and redirects the window to open your device's native SMS application (`sms:`) pre-filled for your primary trusted contact. You only need to tap the Send button in your native messaging app.

---

## 🔮 Future Enhancements

* **SMS Gateway Integration:** Connect Twilio APIs or Nexmo SMS nodes to dispatch alerts over standard mobile networks directly from the database server.
* **Geofencing & Safe Zones:** Alert trusted contacts automatically if the user drifts outside pre-set geofenced coordinate shapes.
* **Dynamic Audio Siren Toggles:** Allow users to choose from multiple audible alarm frequencies.

---

## ✍️ Author
Designed, engineered, and documented by **Kushagri Sharma**.
