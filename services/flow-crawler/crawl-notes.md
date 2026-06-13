# Crawl Notes

Natural language instructions for the flow-crawler LLM.
These notes are parsed at startup and used to guide element interaction decisions.

## General behaviour
- Prefer clicking "Continue" or "Next" buttons over "Cancel" or "Back"
- When a form has required fields, always fill them before attempting to submit
- Skip cookie consent banners and GDPR dialogs by clicking "Accept" or "Accept All"
- If a CAPTCHA appears, skip the element and log it as unfilled

## Login flows
- Use credentials from the Credentials sheet in crawl-data.xlsx when available
- After successful login, continue crawling from the landing page

## Form filling
- For date fields, use the format DD/MM/YYYY unless the field hint says otherwise
- For phone number fields, use UK format: 07700 900000
- For postcode fields, use: SW1A 1AA

## Navigation
- Do not follow links that contain "logout", "sign out", or "delete"
- Do not click "Delete", "Remove", or "Destroy" buttons
