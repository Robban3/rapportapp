import '@testing-library/jest-dom/vitest'

// jsdom implementerar inte scrollIntoView. Passloggen rullar ned till senaste
// inlägget efter varje sparning, och anropet landar ibland efter att testet
// avslutats — då blev det ett ohanterat fel som flaggade hela körningen.
// Appen är inte fel; miljön saknar API:t.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}
