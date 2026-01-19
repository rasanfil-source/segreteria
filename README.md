# exnovoGAS: AI Parish Secretary

[![Language: IT](https://img.shields.io/badge/Language-Italian-green?style=flat-square)](README_IT.md) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An intelligent auto-responder system for Gmail, specifically designed for Parish Offices. Powered by Google Apps Script and Google Gemini AI, it handles incoming emails with pastoral sensitivity, doctrinal accuracy, and operational efficiency.

## Overview

**exnovoGAS** is more than just an auto-responder. It's an AI-driven assistant that:
*   **Filters** incoming emails to identify what needs a response.
*   **Classifies** requests (Sacraments, Appointments, Pastoral support, etc.).
*   **Consults** a dynamic Knowledge Base (Google Sheets).
*   **Generates** contextually appropriate responses using Gemini 2.5 Flash.
*   **Validates** responses for tone, safety, and hallucinations.
*   **Learns** from conversation history to avoid repetitive questions ("active listening").

## Key Features

*   **🧠 Advanced RAG (Retrieval-Augmented Generation):** Fetches real-time data from Google Sheets (Mass schedules, events, doctrine).
*   **🛡️ Multi-Level Validation:** Every AI response is scored for quality. If confidence is low, the email is flagged for human review.
*   **✝️ Pastoral Core:** Special logic to distinguish between bureaucratic requests (certificates) and pastoral needs (spiritual support), adjusting the tone accordingly.
*   **📍 Territory Validation:** Automatically checks if an address belongs to the parish territory using regex pattern matching.
*   **🗓️ Liturgical Awareness:** Adapts greetings and content based on the Liturgical Season (Advent, Lent, Easter, Ordinary Time).
*   **🚀 Rate Limiting:** Smart management of Gemini API quotas (RPM, RPD, TPM) with automatic fallback strategies.

## Setup

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/yourusername/exnovoGAS.git
    ```
2.  **Push to Google Apps Script:**
    Using [clasp](https://github.com/google/clasp):
    ```bash
    clasp login
    clasp create --type standalone --title "exnovoGAS"
    clasp push
    ```
3.  **Configure Script Properties:**
    In GAS Editor -> Project Settings -> Script Properties:
    *   `GEMINI_API_KEY`: Your Google Gemini API Key.
    *   `SPREADSHEET_ID`: ID of the Google Sheet acting as Knowledge Base.
4.  **Set up Triggers:**
    Run `setupTrigger()` function once to initialize the time-based trigger (every 10 mins).

## Documentation

*   [**Architecture**](ARCHITECTURE.md): Deep dive into the system design, modules, and data flow.
*   [**Changelog**](CHANGELOG.md): History of updates and improvements.
*   [**Contributing**](CONTRIBUTING.md): Guidelines for submitting PRs and reporting bugs.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
