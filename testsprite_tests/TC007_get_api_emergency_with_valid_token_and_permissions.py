import requests

BASE_URL = "http://localhost:4000"
LOGIN_URL = f"{BASE_URL}/api/auth/login"
EMERGENCY_URL = f"{BASE_URL}/api/emergency"
TIMEOUT = 30

def test_get_api_emergency_with_valid_token_and_permissions():
    # User credentials must have permissions for /api/emergency access
    credentials = {
        "email": "validuser@example.com",
        "password": "validpassword"
    }
    try:
        # Authenticate and get JWT token
        login_resp = requests.post(LOGIN_URL, json=credentials, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        token = login_resp.json().get("token")
        assert token, "Token not found in login response"

        headers = {
            "Authorization": f"Bearer {token}"
        }
        # Call the emergency endpoint
        resp = requests.get(EMERGENCY_URL, headers=headers, timeout=TIMEOUT)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        
        data = resp.json()
        assert isinstance(data, list), f"Expected response to be a list, got {type(data)}"
    except requests.RequestException as e:
        assert False, f"Request to API failed: {e}"

test_get_api_emergency_with_valid_token_and_permissions()
