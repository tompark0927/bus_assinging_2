import requests

BASE_URL = "http://localhost:4000"
LOGIN_ENDPOINT = "/api/auth/login"
SCHEDULES_ENDPOINT = "/api/schedules"

# Test user credentials for authentication
TEST_USER_CREDENTIALS = {
    "email": "testuser@example.com",
    "password": "testpassword"
}

def test_get_api_schedules_with_valid_token_and_valid_query():
    # Login to get valid JWT token
    try:
        login_resp = requests.post(
            f"{BASE_URL}{LOGIN_ENDPOINT}",
            json=TEST_USER_CREDENTIALS,
            timeout=30
        )
        login_resp.raise_for_status()
        token = login_resp.json().get("token")
        assert token, "JWT token was not returned in login response"
    except requests.RequestException as e:
        assert False, f"Authentication request failed: {e}"

    headers = {
        "Authorization": f"Bearer {token}"
    }

    # Prepare valid query parameters for schedules
    # Common example: date_from & date_to
    query_params = {
        "date_from": "2026-03-01",
        "date_to": "2026-03-10"
    }

    try:
        resp = requests.get(
            f"{BASE_URL}{SCHEDULES_ENDPOINT}",
            headers=headers,
            params=query_params,
            timeout=30
        )
        resp.raise_for_status()
    except requests.RequestException as e:
        assert False, f"GET /api/schedules request failed: {e}"

    assert resp.status_code == 200, f"Expected status code 200, got {resp.status_code}"
    try:
        data = resp.json()
    except ValueError:
        assert False, "Response is not valid JSON"

    assert isinstance(data, list), f"Expected response to be a list, got {type(data)}"
    # Optionally check some fields in the first schedule item if present
    if data:
        first = data[0]
        assert isinstance(first, dict), "Schedule item should be a JSON object"

test_get_api_schedules_with_valid_token_and_valid_query()
