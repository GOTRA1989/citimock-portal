# CitiMock Institutional Core Banking & Transaction Monitoring Simulator (Web 2)

An institutional core banking platform simulator equipped with an advanced, rule-based Transaction Monitoring Engine to detect the full 3-stage lifecycle of money laundering.

## 🚀 Live Demo
🔗 **Core Banking Portal:** https://citimock-portal.com

## 📌 Key Features
- **Dynamic Ledger Injection:** Automatically ingests and registers live customer data passed from the KYC platform (Web 1) via URL parameters.
- **Full-Cycle AML Detection (PLI Engine):** Captures continuous user-inputted transactions to detect sequential money laundering typologies:
  - **Placement:** Flags repetitive cash deposits stacking below the $10,000 regulatory reporting threshold (Structuring/Smurfing).
  - **Layering:** Flags high-velocity international wire transfers routed to offshore jurisdictions.
  - **Integration:** Detects suspicious incoming commercial funds returning as clean assets (e.g., property investments, consulting fees).
- **Regulatory STR/SAR Filing:** Integrated compliance dashboard to draft official Suspicious Transaction Reports with comprehensive narrative blocks, exportable to **PDF format**.

## 🔄 Cross-Platform Data Workflow
1. This system (**Web 2**) listens to incoming deep-links from **Web 1** (e.g., `?customer=Name&country=Country`) and dynamically spawns an active bank account.
2. The user inputs transaction sequences to simulate high-risk behavior, automatically triggering the **PLI Alert Engine**.
3. The analyst clicks **"Investigate Profile"**, which deep-links *back* to **Web 1** to cross-examine the original KYC risk files before submitting the finalized **SAR/STR PDF** report.
