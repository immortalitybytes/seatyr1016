# Seatyr - Event Seating Plan Generator

**Production URL:** https://seatyr.com  
**Current Version:** v1019at331am  
**Status:** Active Development

---

## 📋 Project Overview

Seatyr is a sophisticated event seating plan generator that helps users:
- Manage guest lists and table configurations
- Define seating constraints (must sit together, cannot sit together, adjacent seating)
- Generate optimized seating arrangements using a constraint-solving algorithm
- Save and restore complex seating configurations

### Key Features
- **Guest Management:** Add, edit, and manage guests with party sizes
- **Table Configuration:** Define tables with names and capacity
- **Constraint System:** MUST, CANNOT, and ADJACENT pairing constraints
- **Algorithm Engine:** Advanced constraint-solving seating algorithm
- **Premium Features:** Table naming, multi-table assignments, saved settings
- **User Authentication:** Anonymous and premium user support via Supabase

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Supabase account and project

### Installation
```bash
# Clone repository
git clone [repository-url]
cd seatyr1016

# Install dependencies
npm install

# Set up environment variables
# Create .env file with:
# VITE_SUPABASE_URL=your-supabase-url
# VITE_SUPABASE_ANON_KEY=your-supabase-anon-key

# Start development server
npm run dev
```

### Build for Production
```bash
npm run build
netlify deploy --prod
```

---

## 📁 Project Structure

```
seatyr1016/
├── src/
│   ├── App.tsx                      # Main application
│   ├── main.tsx                     # Entry point
│   ├── context/
│   │   └── AppContext.tsx           # SSOT state management
│   ├── pages/
│   │   ├── GuestManager.tsx         # Guest list management
│   │   ├── TableManager.tsx         # Table configuration
│   │   ├── ConstraintManager.tsx    # Constraint definitions
│   │   ├── SeatingPlanViewer.tsx    # Generated plans display
│   │   ├── SavedSettings.tsx        # Premium saved settings
│   │   └── Account.tsx              # User account
│   ├── utils/
│   │   ├── seatingAlgorithm.ts      # Algorithm adapter
│   │   ├── seatingAlgorithm.engine.ts # Core algorithm
│   │   ├── assignments.ts           # Assignment parsing
│   │   └── premium.ts               # Feature gating
│   └── lib/
│       └── mostRecentState.ts       # Premium state persistence
├── supabase/
│   ├── functions/                   # Edge functions
│   └── migrations/                  # Database migrations
├── public/                          # Static assets
└── dist/                            # Build output
```

---

## 🔧 Technology Stack

### Frontend
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Vite** - Build tool
- **React Router** - Navigation

### Backend
- **Supabase** - Authentication, database, storage
- **PostgreSQL** - Database with RLS
- **Stripe** - Payment processing

### Deployment
- **Netlify** - Hosting and continuous deployment
- **Git** - Version control with tags

---

## 📚 Documentation

- **[PROJECT-STATUS.md](./PROJECT-STATUS.md)** - Current issues and active work
- **[VERSION-HISTORY.md](./VERSION-HISTORY.md)** - Version history and resolved issues

### Key Documentation Sections

#### For Developers
- Architecture decisions and patterns
- Critical code sections and gotchas
- Testing checklist
- Deployment procedures

#### For AI Red Teams
- Comprehensive issue analysis
- Root cause investigations
- Debugging strategies
- Lessons learned

---

## 🐛 Known Issues

See [PROJECT-STATUS.md](./PROJECT-STATUS.md) for complete list of active issues.

### Critical (P0)
- Route-dependent reload failures
- Anonymous user data loss on reload
- Database migration schema verification needed

### High Priority (P1)
- Multi-table assignment UI blocked
- Premium table name assignments not working
- Star emoji display in constraint grid

---

## 🧪 Testing

### Manual Testing Checklist
```bash
# Run development server
npm run dev

# Test anonymous user workflow
# 1. Add guests
# 2. Configure tables
# 3. Add constraints
# 4. Generate seating plan
# 5. Reload page → verify data persists

# Test premium user workflow
# 1. Sign in
# 2. Rename tables
# 3. Save settings
# 4. Reload → verify auto-restore
```

### Browser Console Logging
The app includes comprehensive logging:
- `[Init]` - Session initialization
- `[Auth]` - Authentication events  
- `[Session Restore]` - State restoration
- `[Anonymous Persist]` - LocalStorage operations
- `[Assignment Debug]` - Assignment processing

---

## 🚀 Deployment

### Production Deployment
```bash
# Build application
npm run build

# Deploy to Netlify
netlify deploy --prod

# Tag version
git tag v[date]at[time]
git push origin v[date]at[time]
```

### Rollback
```bash
# Rollback to previous version
git checkout v1015at230am
npm run build
netlify deploy --prod
```

---

## 🔐 Environment Variables

Required environment variables:
```
VITE_SUPABASE_URL=your-supabase-project-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_STRIPE_PUBLISHABLE_KEY=your-stripe-key
```

---

## 📝 Version Control

### Tagging Convention
Format: `v[MMDD]at[HHMM][am/pm]`  
Example: `v1019at331am`

### Branches
- `main` - Production branch
- Feature branches for major changes

---

## 🤝 Contributing

1. Create feature branch from `main`
2. Make changes with comprehensive testing
3. Document changes in PROJECT-STATUS.md
4. Test reload behavior on all routes
5. Submit for review

### Code Standards
- TypeScript strict mode
- ESLint clean (no warnings)
- Consistent logging patterns
- Comments for complex logic

---

## 📞 Support

For issues or questions:
1. Check [PROJECT-STATUS.md](./PROJECT-STATUS.md) for known issues
2. Check browser console for error logs
3. Review [VERSION-HISTORY.md](./VERSION-HISTORY.md) for similar past issues

---

## 📜 License

[License information]

---

## 🎯 Roadmap

### Immediate
- Fix route-dependent reload issues
- Complete database migration Phase A
- Fix multi-table assignment UI

### Short Term
- Comprehensive test suite
- Performance optimization
- Improved error handling

### Long Term
- Mobile responsive design
- Advanced algorithm options
- Export/import functionality

---

**Last Updated:** October 20, 2025  
**Maintained By:** Daniel Abrams
