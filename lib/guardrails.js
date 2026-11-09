// ============================================================================
// FoodieAgent Enterprise Guardrails & Safety Engine
// Protects against Prompt Injections, Financial Inconsistencies & Allergen Risks
// ============================================================================

const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous\s+)?instructions/i,
  /system\s+prompt/i,
  /you\s+are\s+now\s+in\s+(?:dan|developer|god)\s+mode/i,
  /give\s+(?:me\s+)?(?:free|zero\s+rupee)\s+(?:food|pizza|order)/i,
  /bypass\s+(?:all\s+)?(?:rules|restrictions|limits)/i,
  /drop\s+table/i,
  /delete\s+from\s+fa_/i,
  /<script\b[^>]*>/i
];

const COMMON_ALLERGENS = [
  { name: "mushroom", keywords: ["mushroom", "fungi", "truffle"] },
  { name: "peanut", keywords: ["peanut", "groundnut", "peanut butter"] },
  { name: "nut", keywords: ["cashew", "almond", "walnut", "pistachio", "nut"] },
  { name: "dairy", keywords: ["cheese", "paneer", "milk", "butter", "cream", "mozzarella"] },
  { name: "gluten", keywords: ["wheat", "crust", "flour", "bread", "pasta"] },
  { name: "soy", keywords: ["soy", "tofu", "soya"] },
  { name: "shellfish", keywords: ["prawn", "shrimp", "crab", "lobster"] }
];

export const guardrails = {
  /**
   * 1. Prompt Injection & Adversarial Attack Detection
   */
  validateUserInput(text) {
    const raw = String(text || "").trim();
    if (!raw) return { safe: false, reason: "Empty input" };

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(raw)) {
        return {
          safe: false,
          flagged: true,
          reason: "Adversarial input detected. Guardrails intercepted prompt injection or unauthorized instruction override.",
          safeResponse: "🛡️ **Safety Guardrail Activated:** I am programmed to operate strictly within the FoodieAgent catalogue, pricing rules, and safety bounds. How can I assist you with standard menu recommendations?"
        };
      }
    }

    return { safe: true, flagged: false };
  },

  /**
   * 2. Financial Math Invariant Assertion
   * Ensures zero floating-point discrepancies or price tampering
   */
  verifyFinancialInvariants({ unitPricePaise, quantity = 1, deliveryFeePaise = 0, taxPaise, totalPaise, budgetPaise = null }) {
    const price = Math.round(Number(unitPricePaise));
    const qty = Math.round(Number(quantity));
    const delivery = Math.round(Number(deliveryFeePaise));
    const tax = Math.round(Number(taxPaise));
    const total = Math.round(Number(totalPaise));

    if (price < 0 || qty < 1 || qty > 10 || delivery < 0 || tax < 0 || total < 0) {
      throw new Error("Guardrail Violation: Prices, quantity, and taxes must be non-negative safe integers.");
    }

    const expectedSubtotal = price * qty;
    const expectedTax = Math.round(expectedSubtotal * 0.05); // Exact 5% tax
    const expectedTotal = expectedSubtotal + delivery + expectedTax;

    if (total !== expectedTotal) {
      throw new Error(`Guardrail Violation: Price calculation invariant failed. Expected ₹${(expectedTotal / 100).toFixed(2)}, got ₹${(total / 100).toFixed(2)}.`);
    }

    if (budgetPaise !== null && total > Number(budgetPaise)) {
      throw new Error(`Guardrail Violation: Hard budget limit breached. Total ₹${(total / 100).toFixed(2)} exceeds budget ₹${(budgetPaise / 100).toFixed(2)}.`);
    }

    return {
      valid: true,
      subtotalPaise: expectedSubtotal,
      deliveryFeePaise: delivery,
      taxPaise: expectedTax,
      totalPaise: expectedTotal
    };
  },

  /**
   * 3. Allergen & Health Safety Filter
   * Cross-checks dish ingredients against user's discovered LTM facts
   */
  checkAllergenSafety(dish, userAllergies = []) {
    if (!dish || !userAllergies || !userAllergies.length) {
      return { safe: true, detectedAllergens: [], warning: null };
    }

    const textToScan = `${dish.name || ""} ${dish.description || ""} ${dish.tags || ""}`.toLowerCase();
    const detected = [];

    for (const allergy of userAllergies) {
      const allergyKey = String(allergy).toLowerCase();
      for (const group of COMMON_ALLERGENS) {
        if (group.name.includes(allergyKey) || allergyKey.includes(group.name)) {
          for (const kw of group.keywords) {
            if (textToScan.includes(kw)) {
              detected.push(group.name);
              break;
            }
          }
        }
      }
    }

    const uniqueDetected = [...new Set(detected)];
    if (uniqueDetected.length > 0) {
      return {
        safe: false,
        detectedAllergens: uniqueDetected,
        warning: `⚠️ **Allergen Alert**: Contains ingredients associated with your recorded sensitivity: ${uniqueDetected.join(", ")}.`
      };
    }

    return { safe: true, detectedAllergens: [], warning: null };
  }
};

export default guardrails;

