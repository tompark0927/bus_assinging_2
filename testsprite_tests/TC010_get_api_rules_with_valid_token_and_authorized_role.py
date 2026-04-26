import requests

BASE_URL = "http://localhost:4000"
LOGIN_ENDPOINT = "/api/auth/login"
RULES_ENDPOINT = "/api/rules"
TIMEOUT = 30

def test_get_api_rules_with_valid_token_and_authorized_role():
    # Use known valid credentials with authorized role for rules access
    credentials = {
        "email": "user@example.com",
        "password": "correct_password"
    }

    try:
        # Authenticate to get JWT token
        login_resp = requests.post(
            BASE_URL + LOGIN_ENDPOINT,
            json=credentials,
            timeout=TIMEOUT
        )
        assert login_resp.status_code == 200, f"Login failed with status {login_resp.status_code}"
        token = login_resp.json().get("token")
        assert token and isinstance(token, str), "Token not found or invalid in login response"

        headers = {
            "Authorization": f"Bearer {token}"
        }

        # Call GET /api/rules with valid token and authorized role
        rules_resp = requests.get(
            BASE_URL + RULES_ENDPOINT,
            headers=headers,
            timeout=TIMEOUT
        )
        assert rules_resp.status_code == 200, f"Expected 200 OK but got {rules_resp.status_code}"

        data = rules_resp.json()
        assert isinstance(data, list), "Response is not an array"

    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

test_get_api_rules_with_valid_token_and_authorized_role()
