import requests

BASE_URL = "http://localhost:4000"
LOGIN_ENDPOINT = "/api/auth/login"
CHAT_ENDPOINT = "/api/chat"

# Replace these credentials with valid ones for your system
VALID_USER_CREDENTIALS = {
    "username": "validuser",
    "password": "validpassword"
}

def test_get_api_chat_with_valid_token():
    timeout = 30
    try:
        # Authenticate and get JWT token
        login_resp = requests.post(
            BASE_URL + LOGIN_ENDPOINT,
            json=VALID_USER_CREDENTIALS,
            timeout=timeout
        )
        assert login_resp.status_code == 200, f"Login failed with status {login_resp.status_code}"
        login_data = login_resp.json()
        token = login_data.get("token") or login_data.get("accessToken") or login_data.get("jwt")
        assert token, "Token not found in login response"

        headers = {
            "Authorization": f"Bearer {token}"
        }

        # Call GET /api/chat with valid token
        chat_resp = requests.get(
            BASE_URL + CHAT_ENDPOINT,
            headers=headers,
            timeout=timeout
        )
        assert chat_resp.status_code == 200, f"Expected 200 OK, got {chat_resp.status_code}"
        chat_data = chat_resp.json()
        assert isinstance(chat_data, list), "Response data is not an array"
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

test_get_api_chat_with_valid_token()