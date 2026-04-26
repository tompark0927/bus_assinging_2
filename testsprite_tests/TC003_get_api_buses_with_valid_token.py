import requests

BASE_URL = "http://localhost:4000"
LOGIN_ENDPOINT = "/api/auth/login"
BUSES_ENDPOINT = "/api/buses"
TIMEOUT = 30

def test_get_api_buses_with_valid_token():
    login_url = BASE_URL + LOGIN_ENDPOINT
    buses_url = BASE_URL + BUSES_ENDPOINT

    # Replace these credentials with valid test user credentials
    credentials = {
        "email": "testuser@example.com",
        "password": "testpassword"
    }

    try:
        # Authenticate to get JWT token
        login_response = requests.post(login_url, json=credentials, timeout=TIMEOUT)
        assert login_response.status_code == 200, f"Login failed with status code {login_response.status_code}"
        login_data = login_response.json()
        assert "token" in login_data, "No token found in login response"

        token = login_data.get("token")
        headers = {
            "Authorization": f"Bearer {token}"
        }

        # Call GET /api/buses with valid token
        buses_response = requests.get(buses_url, headers=headers, timeout=TIMEOUT)
        assert buses_response.status_code == 200, f"Expected status code 200 but got {buses_response.status_code}"

        buses_data = buses_response.json()
        assert isinstance(buses_data, list), "Response is not an array"

    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

test_get_api_buses_with_valid_token()
