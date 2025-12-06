# ChatSQL 🗄️💬

A modern database visualizer with analytics and AI-powered query generation. Making database management cool again.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)

## ✨ Features

- 🔐 **Secure Authentication** - JWT-based auth with HTTP-only cookies
- 🔌 **Multi-Database Support** - Connect to PostgreSQL, MySQL, and more
- 📊 **Visual Table Explorer** - Browse, search, filter, and edit data
- 📈 **Custom Dashboards** - Build analytics dashboards with widgets
- 🤖 **AI Query Generation** - Write queries in plain English
- 🗺️ **ERD Visualization** - Auto-generated entity relationship diagrams
- ⚡ **SQL Editor** - Execute queries with syntax highlighting
- 📜 **Query History** - Save and reuse your queries

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.0.0
- PostgreSQL >= 14
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/ayan-mn18/ChatSQL.git
   cd ChatSQL
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Set up the database**
   ```bash
   # Create the database
   psql -U postgres -c "CREATE DATABASE chatsql;"
   
   # Run the schema
   psql -U postgres -d chatsql -f database/schema.sql
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

The API will be available at `http://localhost:3000`

## 📁 Project Structure

```
ChatSQL/
├── database/
│   ├── schema.sql          # Database schema
│   └── seed.sql            # Seed data (optional)
├── src/
│   ├── config/             # Configuration files
│   ├── controllers/        # Route controllers
│   ├── middleware/         # Express middleware
│   ├── routes/             # API routes
│   ├── services/           # Business logic
│   ├── types/              # TypeScript types
│   └── utils/              # Utility functions
├── server.ts               # Application entry point
└── package.json
```

## 🔌 API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user (sends OTP) |
| POST | `/api/auth/verify-email` | Verify email with OTP |
| POST | `/api/auth/resend-otp` | Resend verification OTP |
| POST | `/api/auth/login` | Login (verified users only) |
| POST | `/api/auth/logout` | Logout user |
| POST | `/api/auth/forgot-password` | Request password reset |
| POST | `/api/auth/reset-password` | Reset password with token |
| GET | `/api/auth/me` | Get current user |
| PUT | `/api/auth/profile` | Update profile |

### Health Check

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Check API health |

*More endpoints coming soon...*

## 🔐 Authentication Flow

```
1. User registers with email/password
2. System sends 6-digit OTP to email
3. User enters OTP to verify email
4. User can now login with verified email
5. JWT token stored in HTTP-only cookie
6. Logout clears the cookie
```

## ⚙️ Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port | No (default: 3000) |
| `NODE_ENV` | Environment | No (default: development) |
| `DB_HOST` | Database host | Yes |
| `DB_PORT` | Database port | No (default: 5432) |
| `DB_NAME` | Database name | Yes |
| `DB_USERNM` | Database username | Yes |
| `DB_PWD` | Database password | Yes |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | Yes |
| `SMTP_HOST` | SMTP server host | Yes |
| `SMTP_PORT` | SMTP server port | No (default: 587) |
| `SMTP_USER` | SMTP username | Yes |
| `SMTP_PASS` | SMTP password | Yes |
| `SMTP_FROM_EMAIL` | Sender email address | Yes |
| `SMTP_FROM_NAME` | Sender name | No (default: ChatSQL) |
| `FRONTEND_URL` | Frontend URL for email links | No |
| `CORS_ORIGIN` | Allowed CORS origin | No |

## 🛠️ Development

```bash
# Run in development mode with hot reload
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## 🗺️ Roadmap

- [x] Project setup & authentication
- [ ] Connection management
- [ ] Schema & metadata APIs
- [ ] Table data CRUD
- [ ] SQL query execution
- [ ] AI query generation
- [ ] Dashboard & widgets
- [ ] ERD visualization

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Express.js](https://expressjs.com/)
- Database ORM by [Sequelize](https://sequelize.org/)
- AI powered by [OpenAI](https://openai.com/) & [Anthropic](https://anthropic.com/)

---

Made with ❤️ by [Ayan](https://github.com/ayan-mn18)