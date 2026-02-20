# Contributing to SPA (Segreteria Parrocchiale Automatica)

[![Language: IT](https://img.shields.io/badge/Language-Italian-green?style=flat-square)](CONTRIBUTING_IT.md)

Thank you for your interest in contributing to SPA! We welcome contributions from developers, pastoral workers, and anyone interested in the intersection of faith and technology.

## How to Contribute

1.  **Fork the Repository**
2.  **Create a Feature Branch** (`git checkout -b feature/AmazingFeature`)
3.  **Commit your Changes** (`git commit -m 'Add some AmazingFeature'`)
4.  **Push to the Branch** (`git push origin feature/AmazingFeature`)
5.  **Open a Pull Request**

## Development Standards

### Code Style
*   We use standard JavaScript (ES6+ supported by GAS V8 runtime).
*   **JSDoc** is mandatory for all public functions and classes.
*   Variable names should be descriptive (camelCase).

### Testing
*   **Unit Tests**: Run `node gas_unit_tests.js` locally (requires node setup) or `runAllTests()` in the GAS editor.
*   **Safety**: Ensure that your changes do not compromise the "Safety Valve" or Rate Limiting logic.
*   **Pastoral Sensitivity**: Any change affecting response generation must be tested against pastoral scenarios (e.g., bereavement, spiritual distress) to ensure tone remains appropriate.

## Feedback and Suggestions

To propose features or report unexpected behavior, please open an issue on GitHub with:
1.  Description of the observed behavior.
2.  Steps to reproduce the scenario.
3.  Relevant logs (sanitized).
4.  Expected vs Actual outcome.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
