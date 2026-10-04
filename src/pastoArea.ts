export const PASTO_SERVICE_BOUNDS = {
  minLatitude: 1.16,
  maxLatitude: 1.30,
  minLongitude: -77.36,
  maxLongitude: -77.20,
} as const;

const ADDRESS_SEPARATOR = " # ";

/** Validación de interfaz; el backend Python repite esta regla como autoridad. */
export function isWithinPastoServiceArea(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= PASTO_SERVICE_BOUNDS.minLatitude &&
    latitude <= PASTO_SERVICE_BOUNDS.maxLatitude &&
    longitude >= PASTO_SERVICE_BOUNDS.minLongitude &&
    longitude <= PASTO_SERVICE_BOUNDS.maxLongitude
  );
}

/** Normaliza abreviaturas visualmente sin geocodificar ni inventar coordenadas. */
export function normalizePastoAddress(address: string): string {
  let normalized = address.trim().replace(/\s+/g, " ");

  const replacements: Array<[RegExp, string]> = [
    [/\b(?:av|avda|avenida)\.?(?=\s|#|$)/gi, "Avenida"],
    [/\b(?:cra|carr|cr|carrera)\.?(?=\s|#|$)/gi, "Carrera"],
    [/\b(?:cll|cl|cal|calle)\.?(?=\s|#|$)/gi, "Calle"],
    [/\b(?:tr|transv|transversal)\.?(?=\s|#|$)/gi, "Transversal"],
    [/\b(?:dg|diagonal)\.?(?=\s|#|$)/gi, "Diagonal"],
    [/\b(?:no|num|nro|numero|número)\.?(?=\s|#|$)/gi, "#"],
  ];

  for (const [pattern, replacement] of replacements) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized
    .replace(/\s*#\s*/g, ADDRESS_SEPARATOR)
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rechaza referencias explícitas a otra ciudad antes de enviar texto a la API. */
export function containsForeignCityReference(address: string): boolean {
  const normalized = removeAccents(address).toLowerCase();
  const foreignCities = [
    "bogota",
    "medellin",
    "cali",
    "popayan",
    "ipiales",
    "tumaco",
    "neiva",
    "barranquilla",
    "cartagena",
    "armenia",
    "pereira",
    "manizales",
    "ibague",
    "quito",
    "guayaquil",
    "lima",
    "caracas",
    "santiago",
    "buenos aires",
    "paris",
    "madrid",
    "london",
    "new york",
    "miami",
    "ecuador",
    "peru",
    "venezuela",
    "argentina",
    "francia",
    "espana",
    "reino unido",
    "estados unidos",
    "usa",
  ];

  return foreignCities.some((city) => new RegExp("\\b" + city + "\\b", "u").test(normalized));
}

function removeAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
