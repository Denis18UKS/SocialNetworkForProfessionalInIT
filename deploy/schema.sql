SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    isBlocked VARCHAR(30) NOT NULL DEFAULT 'активен',
    reason_blocked TEXT NULL,
    github_username VARCHAR(255) NULL,
    gitlab_username VARCHAR(255) NULL,
    user_tag VARCHAR(32) NULL,
    avatar VARCHAR(500) NULL DEFAULT '/uploads/avatar-default.png',
    skills TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_users_email (email),
    UNIQUE KEY unique_users_username (username),
    UNIQUE KEY unique_user_tag (user_tag),
    KEY idx_users_github_username (github_username),
    KEY idx_users_gitlab_username (gitlab_username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repositories (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    repo_name VARCHAR(255) NOT NULL,
    repo_url VARCHAR(1000) NOT NULL,
    last_synced DATETIME NOT NULL,
    provider VARCHAR(20) NOT NULL DEFAULT 'github',
    language VARCHAR(100) NULL,
    stargazers_count INT NOT NULL DEFAULT 0,
    forks_count INT NOT NULL DEFAULT 0,
    repo_external_id VARCHAR(255) NULL,
    PRIMARY KEY (id),
    KEY idx_repositories_user_provider (user_id, provider),
    CONSTRAINT fk_repositories_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS friends (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    friend_id INT UNSIGNED NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_friend_request (user_id, friend_id),
    KEY idx_friends_reverse (friend_id, user_id, status),
    CONSTRAINT fk_friends_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_friends_friend FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chats (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id_1 INT UNSIGNED NOT NULL,
    user_id_2 INT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_private_chat (user_id_1, user_id_2),
    KEY idx_chats_user_2 (user_id_2),
    CONSTRAINT fk_chats_user_1 FOREIGN KEY (user_id_1) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_chats_user_2 FOREIGN KEY (user_id_2) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    chat_id INT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    message LONGTEXT NULL,
    media VARCHAR(1000) NULL,
    file_name VARCHAR(255) NULL,
    file_size BIGINT NULL,
    `read` BOOLEAN NOT NULL DEFAULT FALSE,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    pinned_at DATETIME NULL,
    pinned_by INT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_messages_chat_created (chat_id, created_at),
    KEY idx_messages_user (user_id),
    CONSTRAINT fk_messages_chat FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    CONSTRAINT fk_messages_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS group_chats (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    creator_id INT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_group_chats_creator (creator_id),
    CONSTRAINT fk_group_chats_creator FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS group_chat_members (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    group_chat_id INT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'member',
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_group_member (group_chat_id, user_id),
    KEY idx_group_members_user (user_id),
    CONSTRAINT fk_group_members_chat FOREIGN KEY (group_chat_id) REFERENCES group_chats(id) ON DELETE CASCADE,
    CONSTRAINT fk_group_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS group_chat_messages (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    group_chat_id INT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    message LONGTEXT NULL,
    media VARCHAR(1000) NULL,
    file_name VARCHAR(255) NULL,
    file_size BIGINT NULL,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    pinned_at DATETIME NULL,
    pinned_by INT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_group_messages_chat_created (group_chat_id, created_at),
    KEY idx_group_messages_user (user_id),
    CONSTRAINT fk_group_messages_chat FOREIGN KEY (group_chat_id) REFERENCES group_chats(id) ON DELETE CASCADE,
    CONSTRAINT fk_group_messages_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS news (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    description LONGTEXT NOT NULL,
    link VARCHAR(1000) NULL,
    image_url VARCHAR(1000) NULL,
    author_id INT UNSIGNED NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'ожидание',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_news_status_created (status, created_at),
    CONSTRAINT fk_news_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS posts (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    description LONGTEXT NOT NULL,
    image_url VARCHAR(1000) NULL,
    attachment_url VARCHAR(1000) NULL,
    attachment_name VARCHAR(255) NULL,
    attachment_size BIGINT NULL,
    attachment_type VARCHAR(255) NULL,
    code_content LONGTEXT NULL,
    code_language VARCHAR(50) NULL,
    author_id INT UNSIGNED NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'ожидание',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_posts_status_created (status, created_at),
    KEY idx_posts_author (author_id),
    CONSTRAINT fk_posts_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS forums (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    question VARCHAR(500) NOT NULL,
    description LONGTEXT NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'Открыт',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_forums_status_created (status, created_at),
    KEY idx_forums_user (user_id),
    CONSTRAINT fk_forums_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS forum_answers (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    forum_id INT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    answer LONGTEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_forum_answers_forum_created (forum_id, created_at),
    KEY idx_forum_answers_user (user_id),
    CONSTRAINT fk_forum_answers_forum FOREIGN KEY (forum_id) REFERENCES forums(id) ON DELETE CASCADE,
    CONSTRAINT fk_forum_answers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS forum_answer_comments (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    answer_id INT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    comment LONGTEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_forum_comments_answer_created (answer_id, created_at),
    KEY idx_forum_comments_user (user_id),
    CONSTRAINT fk_forum_comments_answer FOREIGN KEY (answer_id) REFERENCES forum_answers(id) ON DELETE CASCADE,
    CONSTRAINT fk_forum_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_blacklist (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    blocker_id INT UNSIGNED NOT NULL,
    blocked_id INT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_user_block (blocker_id, blocked_id),
    KEY idx_user_blacklist_blocked (blocked_id),
    CONSTRAINT fk_user_blacklist_blocker FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_blacklist_blocked FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_clears (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    chat_id INT UNSIGNED NOT NULL,
    cleared_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY unique_chat_clear (user_id, chat_id),
    CONSTRAINT fk_chat_clears_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_chat_clears_chat FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS group_chat_clears (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    group_chat_id INT UNSIGNED NOT NULL,
    cleared_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY unique_group_chat_clear (user_id, group_chat_id),
    CONSTRAINT fk_group_chat_clears_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_group_chat_clears_chat FOREIGN KEY (group_chat_id) REFERENCES group_chats(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS message_pins (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    message_id INT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_message_pin (user_id, message_id),
    CONSTRAINT fk_message_pins_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_message_pins_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS group_message_pins (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    message_id INT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_group_message_pin (user_id, message_id),
    CONSTRAINT fk_group_message_pins_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_group_message_pins_message FOREIGN KEY (message_id) REFERENCES group_chat_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS github_repo_branches (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    repo_name VARCHAR(255) NOT NULL,
    branch_name VARCHAR(255) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    last_synced DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY unique_cached_branch (user_id, repo_name, branch_name),
    CONSTRAINT fk_github_branches_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS github_repo_commits (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    repo_name VARCHAR(255) NOT NULL,
    branch_name VARCHAR(255) NOT NULL,
    sha VARCHAR(80) NOT NULL,
    message TEXT NULL,
    author_name VARCHAR(255) NULL,
    author_avatar VARCHAR(1000) NULL,
    commit_date DATETIME NULL,
    html_url VARCHAR(1000) NULL,
    last_synced DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY unique_cached_commit (user_id, repo_name, branch_name, sha),
    CONSTRAINT fk_github_commits_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS github_repo_files (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    repo_name VARCHAR(255) NOT NULL,
    branch_name VARCHAR(255) NOT NULL,
    path_key VARCHAR(500) NOT NULL,
    file_path VARCHAR(1000) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(20) NOT NULL,
    download_url VARCHAR(1500) NULL,
    html_url VARCHAR(1500) NULL,
    last_synced DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY unique_cached_file (user_id, repo_name(191), branch_name(191), path_key(191), file_path(191)),
    CONSTRAINT fk_github_files_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
