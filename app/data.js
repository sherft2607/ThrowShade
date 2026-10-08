// Building catalogue and style legend for throwShade. Plain script (no modules) so the app also runs from file://.

// Style colours come straight from the Screen Map legend; the last four extend it in the same muted register.
window.TS_STYLES = {
  'Brutalist':        '#c2410c',
  'Modernist':        '#1d6f8c',
  'Postmodern':       '#7a8b2e',
  'Deconstructivist': '#8a4fa0',
  'Art Deco':         '#a68a1d',
  'High-tech':        '#b3364a',
  'Contemporary':     '#2f6b4f',
  'Historic':         '#7c6a58',
};

window.TS_BUILDINGS = [
  // New York
  { id: 'seagram', name: 'Seagram Building', architect: 'Mies van der Rohe', year: 1958, typology: 'Office tower', style: 'Modernist', city: 'New York', country: 'USA', lat: 40.7584, lng: -73.9722 },
  { id: 'lever-house', name: 'Lever House', architect: 'SOM · Gordon Bunshaft', year: 1952, typology: 'Office tower', style: 'Modernist', city: 'New York', country: 'USA', lat: 40.7597, lng: -73.9727 },
  { id: 'guggenheim-ny', name: 'Solomon R. Guggenheim Museum', architect: 'Frank Lloyd Wright', year: 1959, typology: 'Museum', style: 'Modernist', city: 'New York', country: 'USA', lat: 40.7830, lng: -73.9590 },
  { id: 'un-secretariat', name: 'UN Secretariat Building', architect: 'Wallace Harrison et al.', year: 1952, typology: 'Civic', style: 'Modernist', city: 'New York', country: 'USA', lat: 40.7489, lng: -73.9680 },
  { id: 'ford-foundation', name: 'Ford Foundation Building', architect: 'Kevin Roche John Dinkeloo', year: 1968, typology: 'Office', style: 'Modernist', city: 'New York', country: 'USA', lat: 40.7494, lng: -73.9713 },
  { id: 'twa', name: 'TWA Flight Center', architect: 'Eero Saarinen', year: 1962, typology: 'Transit', style: 'Modernist', city: 'New York', country: 'USA', lat: 40.6454, lng: -73.7771 },
  { id: 'moma', name: 'Museum of Modern Art', architect: 'Yoshio Taniguchi', year: 2004, typology: 'Museum', style: 'Modernist', city: 'New York', country: 'USA', lat: 40.7614, lng: -73.9776 },
  { id: 'breuer', name: 'The Breuer Building', architect: 'Marcel Breuer', year: 1966, typology: 'Museum', style: 'Brutalist', city: 'New York', country: 'USA', lat: 40.7735, lng: -73.9640 },
  { id: 'chrysler', name: 'Chrysler Building', architect: 'William Van Alen', year: 1930, typology: 'Office tower', style: 'Art Deco', city: 'New York', country: 'USA', lat: 40.7516, lng: -73.9755 },
  { id: 'empire-state', name: 'Empire State Building', architect: 'Shreve, Lamb & Harmon', year: 1931, typology: 'Office tower', style: 'Art Deco', city: 'New York', country: 'USA', lat: 40.7484, lng: -73.9857, leed: 'Gold' },
  { id: 'grand-central', name: 'Grand Central Terminal', architect: 'Reed & Stem · Warren & Wetmore', year: 1913, typology: 'Transit', style: 'Historic', city: 'New York', country: 'USA', lat: 40.7527, lng: -73.9772 },
  { id: 'flatiron', name: 'Flatiron Building', architect: 'Daniel Burnham', year: 1902, typology: 'Office tower', style: 'Historic', city: 'New York', country: 'USA', lat: 40.7411, lng: -73.9897 },
  { id: 'att-building', name: '550 Madison (AT&T Building)', architect: 'Philip Johnson & John Burgee', year: 1984, typology: 'Office tower', style: 'Postmodern', city: 'New York', country: 'USA', lat: 40.7614, lng: -73.9731 },
  { id: 'iac', name: 'IAC Building', architect: 'Frank Gehry', year: 2007, typology: 'Office', style: 'Deconstructivist', city: 'New York', country: 'USA', lat: 40.7489, lng: -74.0079 },
  { id: '8-spruce', name: '8 Spruce Street', architect: 'Frank Gehry', year: 2011, typology: 'Residential tower', style: 'Deconstructivist', city: 'New York', country: 'USA', lat: 40.7107, lng: -74.0056 },
  { id: '41-cooper', name: '41 Cooper Square', architect: 'Morphosis', year: 2009, typology: 'Academic', style: 'Deconstructivist', city: 'New York', country: 'USA', lat: 40.7288, lng: -73.9905, leed: 'Platinum' },
  { id: 'whitney', name: 'Whitney Museum of American Art', architect: 'Renzo Piano', year: 2015, typology: 'Museum', style: 'Contemporary', city: 'New York', country: 'USA', lat: 40.7396, lng: -74.0089 },
  { id: 'oculus', name: 'The Oculus', architect: 'Santiago Calatrava', year: 2016, typology: 'Transit', style: 'Contemporary', city: 'New York', country: 'USA', lat: 40.7115, lng: -74.0110 },
  { id: '56-leonard', name: '56 Leonard', architect: 'Herzog & de Meuron', year: 2017, typology: 'Residential tower', style: 'Contemporary', city: 'New York', country: 'USA', lat: 40.7178, lng: -74.0056 },
  { id: 'via-57', name: 'VIA 57 West', architect: 'BIG', year: 2016, typology: 'Residential', style: 'Contemporary', city: 'New York', country: 'USA', lat: 40.7713, lng: -73.9937 },
  { id: 'vessel', name: 'Vessel', architect: 'Heatherwick Studio', year: 2019, typology: 'Landmark', style: 'Contemporary', city: 'New York', country: 'USA', lat: 40.7538, lng: -74.0022 },
  { id: 'new-museum', name: 'New Museum', architect: 'SANAA', year: 2007, typology: 'Museum', style: 'Contemporary', city: 'New York', country: 'USA', lat: 40.7223, lng: -73.9929 },
  { id: 'hearst', name: 'Hearst Tower', architect: 'Foster + Partners', year: 2006, typology: 'Office tower', style: 'High-tech', city: 'New York', country: 'USA', lat: 40.7663, lng: -73.9827, leed: 'Gold' },
  { id: 'glass-house', name: 'The Glass House', architect: 'Philip Johnson', year: 1949, typology: 'House', style: 'Modernist', city: 'New Canaan', country: 'USA', lat: 41.1437, lng: -73.4960 },

  // Rest of North America
  { id: 'salk', name: 'Salk Institute', architect: 'Louis Kahn', year: 1965, typology: 'Research institute', style: 'Brutalist', city: 'La Jolla', country: 'USA', lat: 32.8871, lng: -117.2459 },
  { id: 'geisel', name: 'Geisel Library', architect: 'William Pereira', year: 1970, typology: 'Library', style: 'Brutalist', city: 'La Jolla', country: 'USA', lat: 32.8812, lng: -117.2376 },
  { id: 'boston-city-hall', name: 'Boston City Hall', architect: 'Kallmann McKinnell & Knowles', year: 1968, typology: 'Civic', style: 'Brutalist', city: 'Boston', country: 'USA', lat: 42.3604, lng: -71.0580 },
  { id: 'habitat-67', name: 'Habitat 67', architect: 'Moshe Safdie', year: 1967, typology: 'Residential', style: 'Brutalist', city: 'Montréal', country: 'Canada', lat: 45.4998, lng: -73.5434 },
  { id: 'kimbell', name: 'Kimbell Art Museum', architect: 'Louis Kahn', year: 1972, typology: 'Museum', style: 'Modernist', city: 'Fort Worth', country: 'USA', lat: 32.7486, lng: -97.3649 },
  { id: 'farnsworth', name: 'Farnsworth House', architect: 'Mies van der Rohe', year: 1951, typology: 'House', style: 'Modernist', city: 'Plano, IL', country: 'USA', lat: 41.6343, lng: -88.5355 },
  { id: 'fallingwater', name: 'Fallingwater', architect: 'Frank Lloyd Wright', year: 1939, typology: 'House', style: 'Modernist', city: 'Mill Run, PA', country: 'USA', lat: 39.9063, lng: -79.4679 },
  { id: 'vanna-venturi', name: 'Vanna Venturi House', architect: 'Robert Venturi', year: 1964, typology: 'House', style: 'Postmodern', city: 'Philadelphia', country: 'USA', lat: 40.0662, lng: -75.2203 },
  { id: 'portland-building', name: 'The Portland Building', architect: 'Michael Graves', year: 1982, typology: 'Civic', style: 'Postmodern', city: 'Portland, OR', country: 'USA', lat: 45.5159, lng: -122.6791 },
  { id: 'piazza-italia', name: "Piazza d'Italia", architect: 'Charles Moore', year: 1978, typology: 'Public space', style: 'Postmodern', city: 'New Orleans', country: 'USA', lat: 29.9477, lng: -90.0663 },
  { id: 'disney-hall', name: 'Walt Disney Concert Hall', architect: 'Frank Gehry', year: 2003, typology: 'Concert hall', style: 'Deconstructivist', city: 'Los Angeles', country: 'USA', lat: 34.0553, lng: -118.2498 },
  { id: 'seattle-library', name: 'Seattle Central Library', architect: 'OMA · Rem Koolhaas', year: 2004, typology: 'Library', style: 'Deconstructivist', city: 'Seattle', country: 'USA', lat: 47.6067, lng: -122.3325 },

  // Europe
  { id: 'barbican', name: 'Barbican Estate', architect: 'Chamberlin, Powell & Bon', year: 1982, typology: 'Residential', style: 'Brutalist', city: 'London', country: 'UK', lat: 51.5202, lng: -0.0937 },
  { id: 'trellick', name: 'Trellick Tower', architect: 'Ernő Goldfinger', year: 1972, typology: 'Residential tower', style: 'Brutalist', city: 'London', country: 'UK', lat: 51.5234, lng: -0.2053 },
  { id: 'national-theatre', name: 'National Theatre', architect: 'Denys Lasdun', year: 1976, typology: 'Theatre', style: 'Brutalist', city: 'London', country: 'UK', lat: 51.5070, lng: -0.1143 },
  { id: 'lloyds', name: "Lloyd's Building", architect: 'Richard Rogers', year: 1986, typology: 'Office', style: 'High-tech', city: 'London', country: 'UK', lat: 51.5131, lng: -0.0822 },
  { id: 'unite', name: "Unité d'Habitation", architect: 'Le Corbusier', year: 1952, typology: 'Residential', style: 'Brutalist', city: 'Marseille', country: 'France', lat: 43.2615, lng: 5.3963 },
  { id: 'villa-savoye', name: 'Villa Savoye', architect: 'Le Corbusier', year: 1931, typology: 'House', style: 'Modernist', city: 'Poissy', country: 'France', lat: 48.9245, lng: 2.0283 },
  { id: 'ronchamp', name: 'Notre-Dame du Haut', architect: 'Le Corbusier', year: 1955, typology: 'Chapel', style: 'Modernist', city: 'Ronchamp', country: 'France', lat: 47.7046, lng: 6.6206 },
  { id: 'pompidou', name: 'Centre Pompidou', architect: 'Renzo Piano & Richard Rogers', year: 1977, typology: 'Museum', style: 'High-tech', city: 'Paris', country: 'France', lat: 48.8606, lng: 2.3522 },
  { id: 'louvre-pyramid', name: 'Louvre Pyramid', architect: 'I. M. Pei', year: 1989, typology: 'Museum', style: 'Modernist', city: 'Paris', country: 'France', lat: 48.8611, lng: 2.3358 },
  { id: 'barcelona-pavilion', name: 'Barcelona Pavilion', architect: 'Mies van der Rohe', year: 1929, typology: 'Pavilion', style: 'Modernist', city: 'Barcelona', country: 'Spain', lat: 41.3705, lng: 2.1500 },
  { id: 'sagrada-familia', name: 'Sagrada Família', architect: 'Antoni Gaudí', year: 1882, typology: 'Basilica', style: 'Historic', city: 'Barcelona', country: 'Spain', lat: 41.4036, lng: 2.1744 },
  { id: 'guggenheim-bilbao', name: 'Guggenheim Museum Bilbao', architect: 'Frank Gehry', year: 1997, typology: 'Museum', style: 'Deconstructivist', city: 'Bilbao', country: 'Spain', lat: 43.2687, lng: -2.9340 },
  { id: 'jewish-museum', name: 'Jewish Museum Berlin', architect: 'Daniel Libeskind', year: 2001, typology: 'Museum', style: 'Deconstructivist', city: 'Berlin', country: 'Germany', lat: 52.5020, lng: 13.3957 },
  { id: 'vitra-fire', name: 'Vitra Fire Station', architect: 'Zaha Hadid', year: 1993, typology: 'Fire station', style: 'Deconstructivist', city: 'Weil am Rhein', country: 'Germany', lat: 47.6023, lng: 7.6200 },
  { id: 'bauhaus', name: 'Bauhaus Dessau', architect: 'Walter Gropius', year: 1926, typology: 'School', style: 'Modernist', city: 'Dessau', country: 'Germany', lat: 51.8397, lng: 12.2275 },
  { id: 'staatsgalerie', name: 'Neue Staatsgalerie', architect: 'James Stirling', year: 1984, typology: 'Museum', style: 'Postmodern', city: 'Stuttgart', country: 'Germany', lat: 48.7801, lng: 9.1868 },
  { id: 'elbphilharmonie', name: 'Elbphilharmonie', architect: 'Herzog & de Meuron', year: 2017, typology: 'Concert hall', style: 'Contemporary', city: 'Hamburg', country: 'Germany', lat: 53.5413, lng: 9.9841 },
  { id: 'therme-vals', name: 'Therme Vals', architect: 'Peter Zumthor', year: 1996, typology: 'Spa', style: 'Contemporary', city: 'Vals', country: 'Switzerland', lat: 46.6206, lng: 9.1766 },

  // Asia, Oceania
  { id: 'heydar-aliyev', name: 'Heydar Aliyev Center', architect: 'Zaha Hadid', year: 2012, typology: 'Cultural centre', style: 'Contemporary', city: 'Baku', country: 'Azerbaijan', lat: 40.3959, lng: 49.8678 },
  { id: 'cctv', name: 'CCTV Headquarters', architect: 'OMA · Rem Koolhaas', year: 2012, typology: 'Office tower', style: 'Deconstructivist', city: 'Beijing', country: 'China', lat: 39.9152, lng: 116.4637 },
  { id: 'hsbc-hk', name: 'HSBC Main Building', architect: 'Foster + Partners', year: 1985, typology: 'Office tower', style: 'High-tech', city: 'Hong Kong', country: 'China', lat: 22.2803, lng: 114.1595 },
  { id: 'church-of-light', name: 'Church of the Light', architect: 'Tadao Ando', year: 1989, typology: 'Chapel', style: 'Contemporary', city: 'Ibaraki, Osaka', country: 'Japan', lat: 34.8163, lng: 135.5367 },
  { id: 'sydney-opera', name: 'Sydney Opera House', architect: 'Jørn Utzon', year: 1973, typology: 'Performing arts', style: 'Modernist', city: 'Sydney', country: 'Australia', lat: -33.8568, lng: 151.2153 },
];

// Sustainability certifications, hand-checked against the certifying body (USGBC has no public API), keyed by
// building id: e.g. 'wd-Q123': ['LEED Gold']. The `leed` field on a hand-curated building above works too.
window.TS_CERTS = {};
