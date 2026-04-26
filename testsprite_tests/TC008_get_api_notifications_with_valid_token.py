import requests

BASE_URL = "http://localhost:4000"
LOGIN_ENDPOINT = "/api/auth/login"
NOTIFICATIONS_ENDPOINT = "/api/notifications"
TIMEOUT = 30

def test_get_api_notifications_with_valid_token():
    # Sample valid user credentials (adjust as per actual test environment)
    credentials = {
        "email": "testuser@example.com",
        "password": "testpassword"
    }
    try:
        # Authenticate to get JWT token
        login_resp = requests.post(
            BASE_URL + LOGIN_ENDPOINT,
            json=credentials,
            timeout=TIMEOUT
        )
        assert login_resp.status_code == 200, f"Login failed with status {login_resp.status_code}"
        token = login_resp.json().get("token") or login_resp.json().get("access_token")
        assert token, "Token not found in login response"

        headers = {
            "Authorization": f"Bearer {token}"
        }

        # Call /api/notifications with valid token
        notifications_resp = requests.get(
            BASE_URL + NOTIFICATIONS_ENDPOINT,
            headers=headers,
            timeout=TIMEOUT
        )
        assert notifications_resp.status_code == 200, f"Expected 200 OK but got {notifications_resp.status_code}"
        data = notifications_resp.json()
        # Validate response is an array (list)
        assert isinstance(data, list), f"Expected response to be a list but got {type(data)}"
    except requests.RequestException as e:
        assert False, f"HTTP request failed: {e}"

test_get_api_notifications_with_valid_token()
