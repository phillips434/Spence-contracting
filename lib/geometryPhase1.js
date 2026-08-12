const DEFAULTS = {
  ROOF_PITCH: 4 / 12,
  ROOF_OVERHANG_IN: 0,
  SIDING_WASTE: 0.10,
  ROOFING_WASTE: 0.10,
  SHEATHING_WASTE: 0.05,
  PANEL_SQFT: 32
};

function _safeNum(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _isPositiveNumber(value) {
  const n = _safeNum(value, null);
  return n !== null && n > 0;
}

function _round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function _matchEvidence(text, questionContext) {
  if (!text || typeof text !== "string") return false;
  if (questionContext && typeof questionContext.originalPrompt === "string") {
    if (questionContext.originalPrompt.includes(text)) return true;
  }
  if (questionContext && Array.isArray(questionContext.history)) {
    return questionContext.history.some(
      (entry) => entry && typeof entry.answer === "string" && entry.answer.includes(text)
    );
  }
  return false;
}

function _normalizeField(field, questionContext) {
  const value = field && Object.prototype.hasOwnProperty.call(field, "value") ? field.value : null;
  const evidenceText = field && typeof field.evidence === "string" ? field.evidence : null;
  const evidenceFound = evidenceText ? _matchEvidence(evidenceText, questionContext) : false;
  return {
    value,
    evidenceText,
    evidenceFound
  };
}

function _isGableRoofType(value) {
  return typeof value === "string" && value.trim().toLowerCase() === "gable";
}

function _parseNumberFromEvidence(text, field) {
  if (!text || typeof text !== "string") return null;
  const normalized = text.trim().toLowerCase();

  if (field === "wallHeight_ft") {
    const match = normalized.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet)\s*(?:tall|high|walls?)/);
    if (match) return _safeNum(match[1], null);
    return null;
  }

  if (field === "length_ft" || field === "width_ft") {
    const match = normalized.match(/(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:x|by)\s*(\d+(?:\.\d+)?)\s*(?:'|ft|feet)/);
    if (match) {
      const first = _safeNum(match[1], null);
      const second = _safeNum(match[2], null);
      if (first !== null && second !== null) {
        return { first, second };
      }
    }
    return null;
  }

  if (field === "roof.type") {
    return _isGableRoofType(normalized) ? "gable" : null;
  }

  if (field === "pitch") {
    const match = normalized.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    if (match) {
      const numerator = _safeNum(match[1], null);
      const denominator = _safeNum(match[2], null);
      if (numerator !== null && denominator !== null && denominator !== 0) {
        return _round2(numerator / denominator);
      }
    }
    return null;
  }

  return null;
}

function _parseOpeningFromEvidence(text) {
  if (!text || typeof text !== "string") return null;
  const normalized = text.trim().toLowerCase();

  const directMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:x|by)\s*(\d+(?:\.\d+)?)\s*(?:'|ft|feet)/);
  if (directMatch) {
    const width = _safeNum(directMatch[1], null);
    const height = _safeNum(directMatch[2], null);
    if (width !== null && height !== null) {
      return { width, height };
    }
  }

  const widthHeightMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*wide\b.*?(?:that is|is|and)?\s*(\d+(?:\.\d+)?)\s*(?:ft|feet)\s*(?:tall|high)/);
  if (widthHeightMatch) {
    const width = _safeNum(widthHeightMatch[1], null);
    const height = _safeNum(widthHeightMatch[2], null);
    if (width !== null && height !== null) {
      return { width, height };
    }
  }

  return null;
}

function determineOpeningsStatus(parsed, questionContext) {
  const openings = Array.isArray(parsed.openings) ? parsed.openings : [];
  const noOpeningsEvidence = parsed.noOpeningsEvidence || null;

  if (typeof noOpeningsEvidence === "string" && _matchEvidence(noOpeningsEvidence, questionContext)) {
    return "verified-none";
  }

  if (openings.length === 0) {
    return "unresolved";
  }

  const allVerified = openings.every((opening) => {
    if (!opening || typeof opening.evidence !== "string") return false;
    if (!_matchEvidence(opening.evidence, questionContext)) return false;
    const parsedDims = _parseOpeningFromEvidence(opening.evidence);
    if (!parsedDims) return false;
    return (
      _safeNum(opening.width_ft, null) === parsedDims.width &&
      _safeNum(opening.height_ft, null) === parsedDims.height
    );
  });

  return allVerified ? "verified" : "unresolved";
}

function computeVerifiedOpeningsArea(parsed, openingsStatus) {
  if (openingsStatus !== "verified") return 0;
  const openings = Array.isArray(parsed.openings) ? parsed.openings : [];
  return openings.reduce((sum, opening) => {
    const width = _safeNum(opening.width_ft, null);
    const height = _safeNum(opening.height_ft, null);
    if (width === null || height === null) return sum;
    return sum + width * height;
  }, 0);
}

function computeRoofArea({ lengthFt, widthFt, pitchRatio, overhangIn }) {
  const L = _safeNum(lengthFt, null);
  const W = _safeNum(widthFt, null);
  if (L === null || W === null) return null;

  const pitch = _safeNum(pitchRatio, DEFAULTS.ROOF_PITCH);
  const overhangFt = _safeNum(overhangIn, DEFAULTS.ROOF_OVERHANG_IN) / 12;

  const planArea = (W + 2 * overhangFt) * (L + 2 * overhangFt);
  const slopeFactor = Math.sqrt(1 + pitch * pitch);
  const roofArea = planArea * slopeFactor;

  return {
    planAreaSqft: Number(planArea.toFixed(4)),
    slopeFactor: Number(slopeFactor.toFixed(6)),
    roofAreaSqft: Number(roofArea.toFixed(4))
  };
}

function computeWallArea({ lengthFt, widthFt, wallHeightFt, pitchRatio }) {
  const L = _safeNum(lengthFt, null);
  const W = _safeNum(widthFt, null);
  const H = _safeNum(wallHeightFt, null);
  if (L === null || W === null || H === null) return null;

  const pitch = _safeNum(pitchRatio, DEFAULTS.ROOF_PITCH);
  const gableSpan = W;
  const rise = (gableSpan / 2) * pitch;
  const oneGableArea = 0.5 * gableSpan * rise;
  const totalGableArea = 2 * oneGableArea;
  const perimeter = 2 * (L + W);

  return {
    grossWallAreaSqft: Number((perimeter * H + totalGableArea).toFixed(4)),
    totalGableAreaSqft: Number(totalGableArea.toFixed(4))
  };
}

function lookupCanonicalArea(quantityBasis, verified) {
  if (quantityBasis === "roof-area") {
    return verified.roofing ? verified.roofing.roofing_area_with_waste_sqft : null;
  }
  if (quantityBasis === "siding-area") {
    return verified.siding ? verified.siding.sidingAreaWithWasteSqft : null;
  }
  if (quantityBasis === "wall-area") {
    return verified.sheathing ? verified.sheathing.sheathingAreaWithWasteSqft : null;
  }
  return null;
}

function isQuantityBasisAllowedForCategory(category, quantityBasis) {
  const cat = typeof category === "string" ? category.trim().toLowerCase() : "";
  if (cat.includes("roof")) return quantityBasis === "roof-area";
  if (cat.includes("siding")) return quantityBasis === "siding-area";
  if (cat.includes("sheath") || cat.includes("wall")) return quantityBasis === "wall-area";
  return false;
}

function categoryGuardPassed(category, verified) {
  const cat = typeof category === "string" ? category.trim().toLowerCase() : "";
  if (cat.includes("roof")) return Boolean(verified.guards && verified.guards.roofing);
  if (cat.includes("siding")) return Boolean(verified.guards && verified.guards.siding);
  if (cat.includes("sheath") || cat.includes("wall")) return Boolean(verified.guards && verified.guards.sheathing);
  return false;
}

function applyPrimaryMaterialOverrides(parsed, verified) {
  if (!parsed || !Array.isArray(parsed.lineItems)) return parsed;

  parsed.lineItems.forEach((li) => {
    if (!Array.isArray(li.materials)) {
      li.overrideSkipped = "missing_materials";
      return;
    }

    const primaryMaterials = li.materials.filter((m) => m.primary === true);
    if (primaryMaterials.length !== 1) {
      li.overrideSkipped =
        primaryMaterials.length === 0 ? "no_primary_material" : "multiple_primary_materials";
      return;
    }

    const primary = primaryMaterials[0];

    if (primary.quantityBasis === "ai-estimated") {
      li.overrideSkipped = "primary_ai_estimated";
      return;
    }

    if (!isQuantityBasisAllowedForCategory(li.category || "", primary.quantityBasis)) {
      li.overrideSkipped = "quantityBasis_not_allowed";
      return;
    }

    if (primary.unit === "sqft") {
      if (primary.basisPerUnit !== null) {
        li.overrideSkipped = "basisPerUnit_must_be_null_for_sqft";
        return;
      }
    } else {
      if (!_isPositiveNumber(primary.basisPerUnit)) {
        li.overrideSkipped = "missing_basisPerUnit";
        return;
      }
    }

    if (!categoryGuardPassed(li.category || "", verified)) {
      li.overrideSkipped = "category_guard_failed";
      return;
    }

    const canonicalArea = lookupCanonicalArea(primary.quantityBasis, verified);
    if (canonicalArea === null) {
      li.overrideSkipped = "canonical_area_missing";
      return;
    }

    const newQty =
      primary.unit === "sqft"
        ? _round2(canonicalArea)
        : Math.ceil(canonicalArea / Number(primary.basisPerUnit));

    primary.qty = newQty;
    li.overrideSkipped = null;
  });

  return parsed;
}

function verifyAndComputeCanonical(parsed = {}, questionContext = {}) {
  const lengthField = _normalizeField(parsed.geometry?.footprint?.length_ft, questionContext);
  const widthField = _normalizeField(parsed.geometry?.footprint?.width_ft, questionContext);
  const wallHeightField = _normalizeField(parsed.geometry?.wallHeight_ft, questionContext);
  const roofTypeField = _normalizeField(parsed.geometry?.roof?.type, questionContext);
  const roofPitchField = _normalizeField(parsed.geometry?.roof?.pitch, questionContext);
  const overhangField = _normalizeField(parsed.geometry?.roof?.overhang_in, questionContext);

  const lengthParsed = _parseNumberFromEvidence(lengthField.evidenceText, "length_ft");
  const widthParsed = _parseNumberFromEvidence(widthField.evidenceText, "width_ft");
  const wallHeightParsed = _parseNumberFromEvidence(wallHeightField.evidenceText, "wallHeight_ft");
  const roofTypeParsed = _parseNumberFromEvidence(roofTypeField.evidenceText, "roof.type");
  const roofPitchParsed = _parseNumberFromEvidence(roofPitchField.evidenceText, "pitch");
  const overhangParsed = _parseNumberFromEvidence(overhangField.evidenceText, "overhang_in");

  const lengthValue = lengthParsed && typeof lengthParsed.first === "number" ? lengthParsed.first : null;
  const widthValue = lengthParsed && typeof lengthParsed.second === "number" ? lengthParsed.second : null;

  const widthValueAlt = widthParsed && typeof widthParsed.first === "number" ? widthParsed.first : null;
  const lengthValueAlt = widthParsed && typeof widthParsed.second === "number" ? widthParsed.second : null;

  const finalLengthValue = lengthValue !== null ? lengthValue : lengthValueAlt;
  const finalWidthValue = widthValue !== null ? widthValue : widthValueAlt;

  const length = {
    value: finalLengthValue,
    sourceType: finalLengthValue !== null ? "user-derived" : "ai-inferred",
    evidenceFound: lengthParsed !== null,
    evidenceText: lengthField.evidenceText
  };

  const width = {
    value: finalWidthValue,
    sourceType: finalWidthValue !== null ? "user-derived" : "ai-inferred",
    evidenceFound: widthParsed !== null,
    evidenceText: widthField.evidenceText
  };

  const wallHeight = {
    value: wallHeightParsed,
    sourceType: wallHeightParsed !== null ? "user-derived" : "ai-inferred",
    evidenceFound: wallHeightParsed !== null,
    evidenceText: wallHeightField.evidenceText
  };

  const roofType = {
    value: _isGableRoofType(roofTypeField.value) ? "gable" : null,
    sourceType: roofTypeField.evidenceFound ? "user-derived" : "ai-inferred",
    evidenceFound: roofTypeField.evidenceFound,
    evidenceText: roofTypeField.evidenceText
  };

  const roofPitchIsVerified = roofPitchField.evidenceFound && roofPitchParsed !== null;
  const pitchValue = roofPitchIsVerified ? roofPitchParsed : DEFAULTS.ROOF_PITCH;
  const roofPitch = {
    value: pitchValue,
    sourceType: roofPitchIsVerified ? "user-derived" : "contractordesk-default",
    evidenceFound: roofPitchIsVerified,
    evidenceText: roofPitchIsVerified ? roofPitchField.evidenceText : null
  };

  const overhangValue = overhangParsed !== null ? overhangParsed : DEFAULTS.ROOF_OVERHANG_IN;
  const overhang = {
    value: overhangValue,
    sourceType: overhangParsed !== null ? "user-derived" : "contractordesk-default",
    evidenceFound: overhangParsed !== null,
    evidenceText: overhangParsed !== null ? overhangField.evidenceText : null
  };

  const openingsStatus = determineOpeningsStatus(parsed, questionContext);
  const openingsAreaSqft = computeVerifiedOpeningsArea(parsed, openingsStatus);

  const wallArea = computeWallArea({
    lengthFt: length.value,
    widthFt: width.value,
    wallHeightFt: wallHeight.value,
    pitchRatio: roofPitch.value
  });

  const netWallArea =
    wallArea === null
      ? null
      : openingsStatus === "verified"
      ? Math.max(0, wallArea.grossWallAreaSqft - openingsAreaSqft)
      : openingsStatus === "verified-none"
      ? wallArea.grossWallAreaSqft
      : null;

  const roofArea = computeRoofArea({
    lengthFt: length.value,
    widthFt: width.value,
    pitchRatio: roofPitch.value,
    overhangIn: overhang.value
  });

  return {
    geometry: {
      footprint: { length_ft: length, width_ft: width },
      wallHeight_ft: wallHeight,
      roof: { type: roofType, pitch: roofPitch, overhang_in: overhang }
    },
    openingsStatus,
    openings: Array.isArray(parsed.openings)
      ? parsed.openings.map((opening) => ({
          width_ft: opening.width_ft,
          height_ft: opening.height_ft,
          evidence: opening.evidence,
          evidenceFound: typeof opening.evidence === "string" ? _matchEvidence(opening.evidence, questionContext) : false
        }))
      : [],
    noOpeningsEvidence: parsed.noOpeningsEvidence || null,
    roofing: {
      roofing_area_sqft: roofArea ? roofArea.roofAreaSqft : null,
      roofing_area_with_waste_sqft: roofArea
        ? Number((roofArea.roofAreaSqft * (1 + DEFAULTS.ROOFING_WASTE)).toFixed(2))
        : null
    },
    siding: {
      grossWallAreaSqft: wallArea ? wallArea.grossWallAreaSqft : null,
      totalGableAreaSqft: wallArea ? wallArea.totalGableAreaSqft : null,
      openingsAreaSqft: openingsStatus === "verified" ? Number(openingsAreaSqft.toFixed(4)) : 0,
      netWallAreaSqft: netWallArea !== null ? Number(netWallArea.toFixed(4)) : null,
      sidingAreaWithWasteSqft: netWallArea !== null ? Number((netWallArea * (1 + DEFAULTS.SIDING_WASTE)).toFixed(2)) : null
    },
    sheathing: {
      sheathingAreaWithWasteSqft:
        netWallArea !== null ? Number((netWallArea * (1 + DEFAULTS.SHEATHING_WASTE)).toFixed(2)) : null
    },
    guards: {
      roofing:
        length.evidenceFound &&
        width.evidenceFound &&
        _isGableRoofType(roofType.value) &&
        roofType.evidenceFound,
      siding:
        length.evidenceFound &&
        width.evidenceFound &&
        wallHeight.evidenceFound &&
        _isGableRoofType(roofType.value) &&
        roofType.evidenceFound &&
        (openingsStatus === "verified" || openingsStatus === "verified-none"),
      sheathing:
        length.evidenceFound &&
        width.evidenceFound &&
        wallHeight.evidenceFound &&
        _isGableRoofType(roofType.value) &&
        roofType.evidenceFound &&
        (openingsStatus === "verified" || openingsStatus === "verified-none")
    },
    defaults: {
      roofPitch: DEFAULTS.ROOF_PITCH,
      roofOverhangIn: DEFAULTS.ROOF_OVERHANG_IN,
      sidingWasteFraction: DEFAULTS.SIDING_WASTE,
      roofingWasteFraction: DEFAULTS.ROOFING_WASTE,
      sheathingWasteFraction: DEFAULTS.SHEATHING_WASTE,
      panelSqft: DEFAULTS.PANEL_SQFT
    }
  };
}

module.exports = {
  verifyAndComputeCanonical,
  applyPrimaryMaterialOverrides
};
