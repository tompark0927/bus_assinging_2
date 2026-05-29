import requests

BASE_URL = "http://localhost:4000"
LOGIN_ENDPOINT = "/api/auth/login"
DAYOFF_ENDPOINT = "/api/dayoff"
TIMEOUT = 30

def test_get_api_dayoff_with_valid_token():
    login_url = BASE_URL + LOGIN_ENDPOINT
    dayoff_url = BASE_URL + DAYOFF_ENDPOINT

    # Use valid credentials for login (assumed known for test)
    credentials = {
        "email": "testuser@example.com",
        "password": "testpassword"
    }

    try:
        # Authenticate to get JWT token
        login_resp = requests.post(login_url, json=credentials, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        login_data = login_resp.json()
        token = login_data.get("token")
        assert token, "Token not found in login response"

        headers = {
            "Authorization": f"Bearer {token}"
        }

        # Call GET /api/dayoff with valid token
        dayoff_resp = requests.get(dayoff_url, headers=headers, timeout=TIMEOUT)
        assert dayoff_resp.status_code == 200, f"Unexpected status code: {dayoff_resp.status_code}"

        dayoff_data = dayoff_resp.json()
        assert isinstance(dayoff_data, list), "Response data is not an array"

    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

test_get_api_dayoff_with_valid_token()
