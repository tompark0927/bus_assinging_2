import requests

def test_post_api_auth_login_with_valid_credentials():
    base_url = "http://localhost:4000"
    login_url = f"{base_url}/api/auth/login"
    # Typical valid user credentials payload, adjust if required
    payload = {
        "username": "validUser",
        "password": "validPassword"
    }
    headers = {
        "Content-Type": "application/json"
    }
    try:
        response = requests.post(login_url, json=payload, headers=headers, timeout=30)
        # Check for HTTP 200 status code
        assert response.status_code == 200, f"Expected status 200, got {response.status_code}"
        data = response.json()
        # Assert that response contains a JWT token (typically a string in a field like 'token' or 'jwt')
        assert isinstance(data, dict), "Response JSON is not an object"
        token = data.get("token") or data.get("jwt") or data.get("accessToken")
        assert token is not None and isinstance(token, str) and len(token) > 0, "JWT token not found or invalid"
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

test_post_api_auth_login_with_valid_credentials()