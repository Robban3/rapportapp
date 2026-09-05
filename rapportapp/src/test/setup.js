import '@testing-library/jest-dom/vitest'

// jsdom implementerar inte scrollIntoView. Passloggen rullar ned till senaste
// inlägget efter varje sparning, och anropet landar ibland efter att testet
// avslutats — då blev det ett ohanterat fel som flaggade hela körningen.
// Appen är inte fel; miljön saknar API:t.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

// vite injicerar __APP_VERSION__ vid bygget (define i vite.config.js).
// Testerna kör utan den transformen, så adminpanelen behöver en stub.
globalThis.__APP_VERSION__ = 'test'
