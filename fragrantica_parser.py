"""
Fragrantica page text parser.
Extracts vote data from Ctrl+A Ctrl+C raw text content.
"""

import re
from typing import Dict, Optional, Tuple

# =============================================================================
# Fragrantica option names -> our system's key mapping
# =============================================================================

# Rating: direct match
RATING_OPTIONS = ["love", "like", "ok", "dislike", "hate"]

# Season/Time: direct match (Fragrantica order: winter, spring, summer, fall, day, night)
SEASON_TIME_OPTIONS = ["winter", "spring", "summer", "fall", "day", "night"]

# Longevity: Fragrantica uses "very weak" and "long lasting"
LONGEVITY_MAP = {
    "very weak": "poor",
    "weak": "weak", 
    "moderate": "moderate",
    "long lasting": "long",
    "eternal": "eternal"
}

# Sillage: direct match
SILLAGE_OPTIONS = ["intimate", "moderate", "strong", "enormous"]

# Gender: Fragrantica uses spaces, we use underscores
GENDER_MAP = {
    "female": "female",
    "more female": "more_female",
    "unisex": "unisex",
    "more male": "more_male",
    "male": "male"
}

# Price Value: Fragrantica uses different option names
VALUE_MAP = {
    "way overpriced": "overpriced",
    "overpriced": "expensive",
    "ok": "fair",
    "good value": "good",
    "great value": "excellent"
}


# =============================================================================
# Utility functions
# =============================================================================

def parse_vote_count(s: str) -> int:
    """
    Convert vote count string to integer.
    Supports formats: '548', '1.4k', '2.5m'
    """
    s = s.strip().lower().replace(',', '')
    if not s:
        return 0
    
    try:
        if s.endswith('k'):
            return int(float(s[:-1]) * 1000)
        elif s.endswith('m'):
            return int(float(s[:-1]) * 1000000)
        else:
            return int(float(s))
    except ValueError:
        return 0


def _find_section_start(lines: list, markers: list) -> int:
    """
    Find section start position (any marker match).
    Returns line index, or -1 if not found.
    """
    for i, line in enumerate(lines):
        line_lower = line.strip().lower()
        for marker in markers:
            if line_lower == marker.lower():
                return i
    return -1


def _extract_option_value(lines: list, start_idx: int, option_map: dict) -> Dict[str, int]:
    """
    Extract option-value pairs starting from given position.
    option_map: {fragrantica_option_name: our_key}
    """
    result = {}
    remaining_options = set(k.lower() for k in option_map.keys())
    
    i = start_idx
    max_lines = min(start_idx + 50, len(lines))  # limit search range
    
    while i < max_lines and remaining_options:
        line = lines[i].strip().lower()
        
        # Check if this is an option we're looking for
        matched_option = None
        for opt in remaining_options:
            if line == opt:
                matched_option = opt
                break
        
        if matched_option:
            # Find next non-empty line as value
            j = i + 1
            while j < max_lines:
                value_line = lines[j].strip()
                if value_line:
                    # Check if it's a numeric format
                    if re.match(r'^[\d,]+\.?\d*[km]?$', value_line.lower()):
                        our_key = option_map[matched_option] if matched_option in option_map else option_map.get(matched_option.lower())
                        if our_key:
                            result[our_key] = parse_vote_count(value_line)
                        remaining_options.discard(matched_option)
                    break
                j += 1
        
        i += 1
    
    return result


def _extract_simple_options(lines: list, start_idx: int, options: list) -> Dict[str, int]:
    """
    Extract simple options (option name matches our key directly).
    """
    option_map = {opt: opt for opt in options}
    return _extract_option_value(lines, start_idx, option_map)


# =============================================================================
# Main parsing function
# =============================================================================

def parse_fragrantica_text(text: str) -> Tuple[Dict, list]:
    """
    Parse Fragrantica page text from Ctrl+A Ctrl+C.
    
    Args:
        text: Raw text content
        
    Returns:
        (parsed_data, warnings)
        parsed_data: {
            "rating_votes": {"love": 1700, "like": 1700, ...},
            "season_time_votes": {"spring": 1400, ...},
            "longevity_votes": {"eternal": 128, ...},
            "sillage_votes": {"intimate": 326, ...},
            "gender_votes": {"female": 658, ...},
            "value_votes": {"excellent": 17, ...}
        }
        warnings: List of warning messages from parsing
    """
    lines = text.split('\n')
    result = {}
    warnings = []
    
    # 1. Rating (section marker: "Rating" or "User Ratings")
    idx = _find_section_start(lines, ["Rating", "User Ratings"])
    if idx >= 0:
        result["rating_votes"] = _extract_simple_options(lines, idx, RATING_OPTIONS)
        if len(result["rating_votes"]) < len(RATING_OPTIONS):
            warnings.append(f"Rating: found {len(result['rating_votes'])}/{len(RATING_OPTIONS)} options")
    else:
        warnings.append("Rating section not found")
        result["rating_votes"] = {}
    
    # 2. Season/Time (section marker: "When To Wear" or "When to Wear")
    idx = _find_section_start(lines, ["When To Wear", "When to Wear"])
    if idx >= 0:
        result["season_time_votes"] = _extract_simple_options(lines, idx, SEASON_TIME_OPTIONS)
        if len(result["season_time_votes"]) < len(SEASON_TIME_OPTIONS):
            warnings.append(f"Season/Time: found {len(result['season_time_votes'])}/{len(SEASON_TIME_OPTIONS)} options")
    else:
        warnings.append("When To Wear section not found")
        result["season_time_votes"] = {}
    
    # 3. Longevity
    idx = _find_section_start(lines, ["LONGEVITY", "Longevity"])
    if idx >= 0:
        result["longevity_votes"] = _extract_option_value(lines, idx, LONGEVITY_MAP)
        if len(result["longevity_votes"]) < len(LONGEVITY_MAP):
            warnings.append(f"Longevity: found {len(result['longevity_votes'])}/{len(LONGEVITY_MAP)} options")
    else:
        warnings.append("LONGEVITY section not found")
        result["longevity_votes"] = {}
    
    # 4. Sillage
    idx = _find_section_start(lines, ["SILLAGE", "Sillage"])
    if idx >= 0:
        result["sillage_votes"] = _extract_simple_options(lines, idx, SILLAGE_OPTIONS)
        if len(result["sillage_votes"]) < len(SILLAGE_OPTIONS):
            warnings.append(f"Sillage: found {len(result['sillage_votes'])}/{len(SILLAGE_OPTIONS)} options")
    else:
        warnings.append("SILLAGE section not found")
        result["sillage_votes"] = {}
    
    # 5. Gender
    idx = _find_section_start(lines, ["GENDER", "Gender"])
    if idx >= 0:
        result["gender_votes"] = _extract_option_value(lines, idx, GENDER_MAP)
        if len(result["gender_votes"]) < len(GENDER_MAP):
            warnings.append(f"Gender: found {len(result['gender_votes'])}/{len(GENDER_MAP)} options")
    else:
        warnings.append("GENDER section not found")
        result["gender_votes"] = {}
    
    # 6. Price Value
    idx = _find_section_start(lines, ["PRICE VALUE", "Price Value"])
    if idx >= 0:
        result["value_votes"] = _extract_option_value(lines, idx, VALUE_MAP)
        if len(result["value_votes"]) < len(VALUE_MAP):
            warnings.append(f"Price Value: found {len(result['value_votes'])}/{len(VALUE_MAP)} options")
    else:
        warnings.append("PRICE VALUE section not found")
        result["value_votes"] = {}
    
    return result, warnings


# =============================================================================
# Testing
# =============================================================================

if __name__ == "__main__":
    # Simple test
    test_text = """
User Ratings
Rating
love
1.7k
like
1.7k
ok
548
dislike
414
hate
80
When To Wear
winter
658
spring
1.4k
summer
803
fall
1.1k
day
1.4k
night
693
LONGEVITY
no vote
very weak
95
weak
223
moderate
934
long lasting
488
eternal
128
SILLAGE
no vote
intimate
326
moderate
1.1k
strong
395
enormous
130
GENDER
no vote
female
658
more female
497
unisex
497
more male
31
male
11
PRICE VALUE
no vote
way overpriced
235
overpriced
628
ok
498
good value
52
great value
17
"""
    
    data, warns = parse_fragrantica_text(test_text)
    print("Parsed result:")
    for block, votes in data.items():
        print(f"  {block}: {votes}")
    
    if warns:
        print("\nWarnings:")
        for w in warns:
            print(f"  - {w}")
