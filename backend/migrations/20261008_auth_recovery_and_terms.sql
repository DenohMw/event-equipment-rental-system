ALTER TABLE User ADD COLUMN auth_version INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS PasswordResetToken (
    reset_id BIGINT NOT NULL AUTO_INCREMENT,
    user_id INT(11) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (reset_id),
    UNIQUE KEY uq_password_reset_token_hash (token_hash),
    KEY idx_password_reset_user_expiry (user_id, expires_at),
    CONSTRAINT fk_password_reset_user
        FOREIGN KEY (user_id) REFERENCES User(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS TermsAcceptance (
    acceptance_id BIGINT NOT NULL AUTO_INCREMENT,
    user_id INT(11) NOT NULL,
    terms_version VARCHAR(32) NOT NULL,
    accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45) DEFAULT NULL,
    user_agent VARCHAR(255) DEFAULT NULL,
    PRIMARY KEY (acceptance_id),
    KEY idx_terms_acceptance_user (user_id),
    CONSTRAINT fk_terms_acceptance_user
        FOREIGN KEY (user_id) REFERENCES User(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
