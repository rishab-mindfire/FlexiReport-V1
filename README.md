# FileMaker Web-Based Reporting System

A web-based reporting and visualization system integrated inside **FileMaker** using **Web Viewer**, **Node.js (Express)**, and modern **HTML/CSS/JavaScript**. This project enables dynamic reports, ERD diagrams, PDF generation, and JSON previews directly within FileMaker layouts.

---

## 📌 Project Overview

This system is designed to extend FileMaker's native reporting capabilities by embedding a lightweight web application inside FileMaker using the **Web Viewer**. It allows:

* Interactive reports
* ERD diagram visualization
* PDF generation and download
* JSON data preview
* Modular routing for future extensions

All components are served via a local Node.js Express server and accessed from FileMaker.

---

## 🏗 Architecture

```
FileMaker Pro
   └── Web Viewer
         └── http://localhost:8000
               ├── /           → Dashboard (index.html)
               ├── /erd        → ERD Diagram Module
               ├── /report     → Reporting Module
               ├── /pdf        → PDF Generation Module
               └── /demoJSON   → JSON Viewer
```

---

## 🧰 Technology Stack

* **FileMaker Pro** (Client)
* **Node.js**
* **Express.js**
* **HTML5 / CSS3 / JavaScript**
* **PDFMake / jsPDF** (for PDF generation – optional)
* **JSON** for data exchange

---

## 📂 Folder Structure

```
project-root/
│── server.js
│── index.html        # Dashboard
│
├── ERD-diagram/      # ERD visualization module
│├── index.html
│├── style.css
│└── index.js
│
├── Report/           # Reporting UI
├── PDF-Download/     # PDF generation
└── demoJSON/         # JSON preview
```

---

## 🚀 Getting Started

### 1️⃣ Install Dependencies

```bash
npm install express
```

### 2️⃣ Start Server

```bash
node server.js
```

Server will run at:

```
http://localhost:8000
```

---

## 🖥 FileMaker Integration

1. Open **FileMaker Pro**
2. Add a **Web Viewer** to your layout
3. Set Web Viewer URL to:

```
http://localhost:8000
```

4. Enable:

   * Allow JavaScript
   * Allow interaction with local content

---

## 📊 Features

### ✔ Dashboard

* Central navigation for all modules

### ✔ ERD Diagram Viewer

* Visualize table relationships

### ✔ Reports

* Dynamic HTML-based reports

### ✔ PDF Export

* Generate and download PDFs

### ✔ JSON Viewer

* Inspect raw JSON data for debugging

---

## 🔐 Security Notes

* Designed for **local / intranet use**
* CORS enabled for FileMaker Web Viewer
* Do NOT expose publicly without authentication

---

## 🧩 Extensibility

You can easily add new modules:

1. Create a new folder
2. Add Express static route
3. Add a button to dashboard

---

## 🛠 Future Enhancements

* Authentication & role-based access
* HTTPS support
* Real-time data sync
* Charting (Recharts / Chart.js)
* FileMaker Data API integration

---

## 👤 Author

FileMaker & Web Integration Developer

---

## 📄 License

This project is for internal / educational use. Modify and extend as needed.
